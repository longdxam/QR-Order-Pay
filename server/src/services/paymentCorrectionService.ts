import type { ClientSession } from 'mongoose';
import type { PaymentDoc } from '../models/Payment.js';
import type { OrderDoc } from '../models/Order.js';
import { paymentCorrectionRepository } from '../repositories/paymentCorrectionRepository.js';
import { paymentRepository } from '../repositories/paymentRepository.js';
import { orderRepository } from '../repositories/orderRepository.js';
import { tableSessionRepository } from '../repositories/tableSessionRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../errors/AppError.js';
import { unitOfWork } from '../infrastructure/unitOfWork.js';
import { ensureOpenShift } from './cashShiftService.js';
import { auditRepository } from '../repositories/auditRepository.js';
import { outboxRepository } from '../repositories/outboxRepository.js';
import { orderRealtimeEvents } from './orderService.js';

export async function assertNoPaymentCorrection(orderId: string, session: ClientSession) {
  const payments = await paymentRepository.listIdsForOrder(orderId, session);
  if (
    await paymentCorrectionRepository.hasPendingFor(
      payments.map((p) => p._id),
      orderId,
      session,
    )
  )
    throw new ConflictError(
      'PAYMENT_CORRECTION_PENDING',
      'Khoản thu đang chờ quản lý duyệt điều chỉnh.',
    );
}

async function guardSession(order: OrderDoc, session: ClientSession, allowClosed = false) {
  if (!order.tableSessionId) {
    if (order.pickup?.outcome !== 'ACTIVE' && !allowClosed)
      throw new ForbiddenError('Đơn mang đi đã kết thúc.');
    await orderRepository.touchVersion(order._id, session);
    return;
  }
  const tableSession = await tableSessionRepository.lockForCorrection(
    order.tableSessionId,
    allowClosed,
    session,
  );
  if (!tableSession)
    throw new ConflictError(
      'PAYMENT_CLAIMED',
      'Bàn đã đóng hoặc đang được thu tiền. Hãy kết thúc thao tác thu tiền trước.',
    );
}

function assertReversible(order: OrderDoc) {
  if (!['AWAITING_PAYMENT', 'PENDING', 'CONFIRMED'].includes(order.status))
    throw new ForbiddenError(
      'Chỉ hủy/đổi đơn nhận khoản thu khi đơn nguồn chưa pha chế. Đơn đã pha chế cần đối soát riêng.',
    );
}

export async function requestPaymentCorrection(
  paymentId: string,
  actorId: string,
  input: {
    kind: 'VOID' | 'METHOD' | 'TRANSFER';
    reason: string;
    method?: 'CASH' | 'BANK_TRANSFER' | 'OTHER';
    targetOrderId?: string;
  },
  execution: 'request' | 'apply' = 'request',
) {
  try {
    return await unitOfWork.withTransaction(async (session) => {
      const payment = await paymentRepository.findById(paymentId, session);
      if (!payment) throw new NotFoundError('Khoản thu không tồn tại.');
      if (payment.status !== 'SUCCESS')
        throw new ConflictError('CONFLICT', 'Khoản thu đã hoàn hoặc đảo.');
      if (payment.orderIds.length !== 1)
        throw new ForbiddenError('Khoản thu cũ gộp nhiều đơn cần đối soát riêng.');
      const order = await orderRepository.findById(payment.orderIds[0]!, session);
      if (!order) throw new NotFoundError('Đơn không tồn tại.');
      await assertNoPaymentCorrection(order.id, session);
      if (input.kind !== 'METHOD') assertReversible(order);
      if (input.kind === 'METHOD' && input.method === payment.method)
        throw new ValidationError('Phương thức mới phải khác phương thức đã ghi.');
      await guardSession(order, session, input.kind === 'METHOD');
      await orderRepository.touchVersion(order._id, session);
      if (input.kind === 'TRANSFER') {
        const target = await orderRepository.findById(input.targetOrderId!, session);
        if (
          !target ||
          target.id === order.id ||
          target.status !== 'AWAITING_PAYMENT' ||
          target.paymentStatus !== 'UNPAID'
        )
          throw new ValidationError('Đơn nhận phải là đơn khác đang chờ thanh toán.');
        if (payment.amount > target.total - (target.paidAmount ?? 0))
          throw new ValidationError('Khoản thu vượt số tiền còn thiếu của đơn nhận.');
        await assertNoPaymentCorrection(target.id, session);
        await guardSession(target, session);
        await orderRepository.touchVersion(target._id, session);
      }
      const actor = await userRepository.findById(actorId, session);
      const correction = await paymentCorrectionRepository.create(
        {
          ...input,
          paymentId,
          paymentVersion: payment.version,
          requestedBy: actorId,
          requestedByName: actor?.name ?? 'Nhân viên',
        },
        session,
      );
      if (!correction) throw new Error('Failed to create payment correction');
      await auditRepository.log(
        {
          actorType: 'USER',
          actorId,
          action: 'payment.correctionRequested',
          entityType: 'PaymentCorrection',
          entityId: correction.id,
          metadata: { paymentId, ...input },
        },
        session,
      );
      // Admin confirmation and its audit/ledger updates commit together with the request.
      if (execution === 'apply' || actor?.role === 'ADMIN')
        return applyPaymentCorrection(
          correction.id,
          actorId,
          {
            expectedVersion: correction.version,
            approve: true,
            note: input.reason,
          },
          session,
        );
      return correction;
    });
  } catch (error) {
    if ((error as { code?: number }).code === 11000)
      throw new ConflictError('CONFLICT', 'Khoản thu đã có yêu cầu điều chỉnh.');
    throw error;
  }
}

async function publish(order: OrderDoc, session: ClientSession) {
  await outboxRepository.createRealtimeEvents(
    orderRealtimeEvents(order, 'order.statusChanged'),
    session,
  );
}

type CorrectionDecision = { expectedVersion: number; approve: boolean; note: string };

export async function decidePaymentCorrection(
  id: string,
  actorId: string,
  input: CorrectionDecision,
) {
  return unitOfWork.withTransaction((session) =>
    applyPaymentCorrection(id, actorId, input, session),
  );
}

async function applyPaymentCorrection(
  id: string,
  actorId: string,
  input: CorrectionDecision,
  session: ClientSession,
) {
  const actor = await userRepository.findById(actorId, session);
  if (!actor || actor.role !== 'ADMIN' || !actor.isActive || actor.isDeleted)
    throw new ForbiddenError('Chỉ quản trị được xác nhận điều chỉnh khoản thu.');
  const correction = await paymentCorrectionRepository.findById(id, session);
  if (!correction) throw new NotFoundError('Yêu cầu không tồn tại.');
  if (correction.status !== 'REQUESTED' || correction.version !== input.expectedVersion)
    throw new ConflictError('CONFLICT', 'Yêu cầu đã được xử lý.');
  const payment = await paymentRepository.findById(correction.paymentId, session);
  if (!payment) throw new NotFoundError('Khoản thu không tồn tại.');
  if (input.approve) {
    if (payment.status !== 'SUCCESS' || payment.version !== correction.paymentVersion)
      throw new ConflictError(
        'CONFLICT',
        'Khoản thu đã thay đổi. Hãy từ chối yêu cầu cũ và lập lại.',
      );
    const order = await orderRepository.findById(payment.orderIds[0]!, session);
    if (!order) throw new NotFoundError('Đơn không tồn tại.');
    if (correction.kind !== 'METHOD') assertReversible(order);
    await guardSession(order, session, correction.kind === 'METHOD');
    const shift = await ensureOpenShift(actorId, session);
    const now = new Date();
    // Preserve amount, method, paidAt and collector of the original receipt.
    payment.status = 'REFUNDED';
    payment.refundShiftId = shift._id;
    payment.refundMethod = payment.method;
    payment.refundedAt = now;
    payment.refundedBy = (await userRepository.findById(actorId, session))!._id;
    payment.refundReason = correction.reason;
    payment.reversalKind = correction.kind;
    payment.version += 1;
    await payment.save({ session });
    if (correction.kind !== 'METHOD') {
      const paidAmount =
        (order.paidAmount ?? (order.paymentStatus === 'PAID' ? order.total : 0)) - payment.amount;
      if (paidAmount < 0)
        throw new ConflictError('CONFLICT', 'Số tiền đã thu không khớp; cần đối soát.');
      order.paidAmount = paidAmount;
      order.paymentStatus = 'UNPAID';
      if (order.status !== 'AWAITING_PAYMENT') {
        order.statusHistory.push({
          from: order.status,
          to: 'AWAITING_PAYMENT',
          at: now,
          by: actorId,
          reason: correction.reason,
        });
        order.status = 'AWAITING_PAYMENT';
      }
    }
    order.version += 1;
    await order.save({ session });
    await publish(order, session);
    if (correction.kind === 'METHOD' || correction.kind === 'TRANSFER') {
      const target =
        correction.kind === 'METHOD'
          ? order
          : await orderRepository.findById(correction.targetOrderId!, session);
      if (!target) throw new NotFoundError('Đơn nhận không tồn tại.');
      if (correction.kind === 'TRANSFER') {
        if (
          target.status !== 'AWAITING_PAYMENT' ||
          target.paymentStatus !== 'UNPAID' ||
          payment.amount > target.total - (target.paidAmount ?? 0)
        )
          throw new ConflictError('CONFLICT', 'Đơn nhận đã thay đổi hoặc không còn đủ dư nợ.');
        await guardSession(target, session);
        target.paidAmount = (target.paidAmount ?? 0) + payment.amount;
        if (target.paidAmount === target.total) {
          target.paymentStatus = 'PAID';
          target.statusHistory.push({
            from: target.status,
            to: 'PENDING',
            at: now,
            by: actorId,
            reason: correction.reason,
          });
          target.status = 'PENDING';
        }
        target.version += 1;
        await target.save({ session });
        await publish(target, session);
      }
      const replacement = await paymentRepository.create(
        {
          tableSessionId: target.tableSessionId,
          orderIds: [target._id],
          amount: payment.amount,
          method: correction.kind === 'METHOD' ? correction.method : payment.method,
          status: 'SUCCESS',
          shiftId: shift._id,
          confirmedBy: actorId,
          paidAt: now,
          idempotencyKey: `correction:${correction.id}`,
          note: correction.reason,
          replacesPaymentId: payment._id,
        },
        session,
      );
      correction.replacementPaymentId = replacement!._id;
    }
  }
  correction.status = input.approve ? 'APPROVED' : 'REJECTED';
  correction.decidedBy = actor!._id;
  correction.decidedByName = actor?.name ?? 'Quản lý';
  correction.decidedAt = new Date();
  correction.decisionNote = input.note;
  correction.version += 1;
  await correction.save({ session });
  await auditRepository.log(
    {
      actorType: 'USER',
      actorId,
      action: `payment.correction${input.approve ? 'Approved' : 'Rejected'}`,
      entityType: 'PaymentCorrection',
      entityId: id,
      metadata: { paymentId: payment.id, kind: correction.kind, note: input.note },
    },
    session,
  );
  return correction;
}

function receiptDto(payment: PaymentDoc) {
  return {
    id: payment.id,
    orderIds: payment.orderIds.map(String),
    tableSessionId: payment.tableSessionId?.toString() ?? null,
    amount: payment.amount,
    method: payment.method,
    status: payment.status,
    paidAt: payment.paidAt,
    confirmedBy: String(payment.confirmedBy),
    note: payment.note,
    refundedAt: payment.refundedAt,
    refundReason: payment.refundReason,
    reversalKind: payment.reversalKind,
    replacesPaymentId: payment.replacesPaymentId?.toString() ?? null,
  };
}

export async function listPaymentAccounting(
  page: number,
  limit: number,
  sessionId?: string,
  scope: 'current' | 'retired' | 'all' = 'current',
) {
  const retiredOrderIds = await orderRepository.listRetiredFulfillmentIds();
  const retiredPaymentIds =
    scope === 'all' ? [] : await paymentRepository.listIdsForOrders(retiredOrderIds);
  const paymentScope =
    scope === 'all' ? {} : { _id: { [scope === 'retired' ? '$in' : '$nin']: retiredPaymentIds } };
  const correctionScope =
    scope === 'all'
      ? {}
      : { paymentId: { [scope === 'retired' ? '$in' : '$nin']: retiredPaymentIds } };
  const filter = { ...paymentScope, ...(sessionId ? { tableSessionId: sessionId } : {}) };
  const [payments, total, corrections, targets] = await Promise.all([
    paymentRepository.page(filter, page, limit),
    paymentRepository.count(filter),
    paymentCorrectionRepository.listRecent(correctionScope),
    orderRepository.listTransferTargets(retiredOrderIds),
  ]);
  const correctionPayments = await paymentRepository.listByIds(corrections.map((c) => c.paymentId));
  const allReceipts = [...payments, ...correctionPayments];
  const orders = await orderRepository.listLabels([
    ...allReceipts.flatMap((p) => p.orderIds),
    ...corrections.flatMap((c) => (c.targetOrderId ? [c.targetOrderId] : [])),
  ]);
  const names = new Map(
    orders.map((o) => [
      o.id,
      {
        code: o.code,
        createdAt: o.createdAt,
        tableName:
          (o.tableId as unknown as { name?: string })?.name ??
          (o.fulfillmentType !== 'DINE_IN' ? 'Đơn lịch sử' : 'Bàn đã lưu trữ'),
      },
    ]),
  );
  return {
    items: payments.map((p) => ({
      ...receiptDto(p),
      orders: p.orderIds.map((id) => names.get(String(id))),
    })),
    total,
    page,
    limit,
    corrections: corrections.map((correction) => {
      const receipt = correctionPayments.find((p) => p._id.equals(correction.paymentId));
      return {
        ...correction,
        receipt: receipt
          ? { ...receiptDto(receipt), orders: receipt.orderIds.map((id) => names.get(String(id))) }
          : null,
        targetOrder: correction.targetOrderId ? names.get(String(correction.targetOrderId)) : null,
      };
    }),
    targets: targets.map((order) => ({
      ...order,
      tableName: (order.tableId as unknown as { name?: string })?.name ?? 'Bàn đã lưu trữ',
    })),
  };
}
