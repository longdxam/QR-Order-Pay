import { paymentRepository } from '../repositories/paymentRepository.js';
import { billRepository } from '../repositories/billRepository.js';
import { orderRepository } from '../repositories/orderRepository.js';
import { tableSessionRepository } from '../repositories/tableSessionRepository.js';
import { guestSessionRepository } from '../repositories/guestSessionRepository.js';
import { tableRepository } from '../repositories/tableRepository.js';
import { unitOfWork } from '../infrastructure/unitOfWork.js';
import { auditRepository } from '../repositories/auditRepository.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../errors/AppError.js';
import type { OrderDoc } from '../models/Order.js';
import type { TableSessionDoc } from '../models/TableSession.js';
import { OrderModel } from '../models/Order.js';
import { ServiceRequestModel } from '../models/ServiceRequest.js';
import { outboxRepository } from '../repositories/outboxRepository.js';
import { UserModel } from '../models/User.js';
import { ensureOpenShift } from './cashShiftService.js';
import { CancelRequestModel } from '../models/CancelRequest.js';

export interface ConfirmPaymentInput {
  tableSessionId: string;
  expectedVersion: number;
  staffId: string;
  amount: number;
  method: 'CASH' | 'BANK_TRANSFER' | 'OTHER';
  note?: string;
  idempotencyKey: string;
}

export async function confirmPayment(input: ConfirmPaymentInput) {
  if (!Number.isInteger(input.amount) || input.amount < 0) {
    throw new ValidationError('Số tiền thanh toán không hợp lệ.');
  }
  const replayed = await replayPayment(input);
  if (replayed) return replayed;
  try {
    return await settleSession(input);
  } catch (error) {
    // Request cùng key có thể đã commit sau bước kiểm tra phía trên (khi đó phiên đã CLOSED
    // nên transaction này báo lỗi): trả lại khoản thu đã ghi thay vì lỗi gây hiểu nhầm.
    const raced = await replayPayment(input);
    if (raced) return raced;
    throw error;
  }
}

async function replayPayment(input: ConfirmPaymentInput) {
  const existing = await paymentRepository.findByIdempotency(input.idempotencyKey);
  if (!existing) return null;
  if (
    existing.tableSessionId.toString() !== input.tableSessionId ||
    existing.amount !== input.amount ||
    existing.method !== input.method ||
    existing.confirmedBy?.toString() !== input.staffId ||
    existing.note !== (input.note ?? '')
  ) {
    throw new ConflictError('IDEMPOTENCY_CONFLICT', 'Mã thanh toán đã dùng cho yêu cầu khác.');
  }
  const bill = await billRepository.findBySession(input.tableSessionId);
  return {
    payment: existing,
    orderIds: existing.orderIds.map((o) => o.toString()),
    replayed: true as const,
    billId: bill?._id.toString() ?? null,
  };
}

async function settleSession(input: ConfirmPaymentInput) {
  const result = await unitOfWork.withTransaction(async (session) => {
    const tableSession = await tableSessionRepository.findById(input.tableSessionId, session);
    if (!tableSession) throw new NotFoundError('Phiên không tồn tại.');
    if (tableSession.status !== 'CHECKOUT')
      throw new ForbiddenError('Hãy chuyển bàn sang thanh toán trước khi thu tiền.');
    if (tableSession.version !== input.expectedVersion) {
      throw new ConflictError('CONFLICT', 'Phiên đã thay đổi, vui lòng tải lại.');
    }
    if (
      await CancelRequestModel.exists({
        tableSessionId: tableSession._id,
        status: 'REQUESTED',
      }).session(session)
    ) {
      throw new ConflictError(
        'CANCEL_REQUEST_PENDING',
        'Còn yêu cầu hủy đang chờ xử lý. Hãy duyệt hoặc từ chối trước khi thu tiền.',
      );
    }

    const allOrders = await OrderModel.find({ tableSessionId: tableSession._id }).session(session);
    if (allOrders.some((o) => !['SERVED', 'CANCELLED'].includes(o.status))) {
      throw new ValidationError(
        'Còn món chưa phục vụ. Hãy hoàn tất hoặc hủy đơn hợp lệ trước khi thu tiền.',
      );
    }
    const orders = allOrders.filter((o) => o.status === 'SERVED' && o.paymentStatus === 'UNPAID');
    if (orders.length === 0) {
      throw new ValidationError('Không có đơn nào đang chờ thanh toán.');
    }
    const expected = orders.reduce((s, o) => s + o.total, 0);
    if (input.amount !== expected) {
      throw new ValidationError(`Số tiền phải thu là ${expected} VND, không khớp với yêu cầu.`);
    }

    const table = await tableRepository.findById(tableSession.tableId.toString(), session);
    if (!table) throw new NotFoundError('Bàn không tồn tại.');
    const cashier = await UserModel.findById(input.staffId).session(session);
    const shift = await ensureOpenShift(input.staffId, session);

    const payment = await paymentRepository.create(
      {
        tableSessionId: tableSession._id,
        shiftId: shift._id,
        orderIds: orders.map((o) => o._id),
        amount: input.amount,
        method: input.method,
        status: 'SUCCESS',
        confirmedBy: new (await import('mongoose')).default.Types.ObjectId(input.staffId),
        paidAt: new Date(),
        idempotencyKey: input.idempotencyKey,
        note: input.note ?? '',
      },
      session,
    );
    await orderRepository.setPaymentStatus(
      orders.map((o) => o._id.toString()),
      'PAID',
      session,
    );

    // Snapshot bất biến của phiên: chốt ngay trong cùng transaction với payment.
    // Đọc lại đơn sau khi cập nhật paymentStatus để snapshot không giữ trạng thái cũ trong bộ nhớ.
    const settledOrders = await OrderModel.find({ tableSessionId: tableSession._id })
      .sort({ createdAt: 1 })
      .session(session);
    const sessionPayments = await paymentRepository.listBySession(
      tableSession._id.toString(),
      session,
    );
    const { bill } = await billRepository.finalize(
      {
        tableSession,
        tableCode: table.code,
        tableName: table.name,
        cashierName: cashier?.name ?? 'Nhân viên',
        orders: settledOrders,
        payments: [
          payment,
          ...sessionPayments.filter((p) => p._id.toString() !== payment._id.toString()),
        ],
        closedAt: new Date(),
      },
      session,
    );

    const closed = await tableSessionRepository.updateStatus(
      tableSession._id.toString(),
      tableSession.version,
      {
        status: 'CLOSED',
        closedBy: input.staffId,
        closedReason: 'PAID',
        billId: bill._id.toString(),
      },
      session,
    );
    if (!closed) throw new ConflictError('CONFLICT', 'Phiên đã thay đổi, vui lòng thử lại.');

    // revoke all guest sessions of this table session
    await guestSessionRepository.revokeByTableSession(tableSession._id.toString(), session);
    await ServiceRequestModel.updateMany(
      { tableSessionId: tableSession._id, status: 'OPEN' },
      { $set: { status: 'RESOLVED', resolvedBy: input.staffId, resolvedAt: new Date() } },
      { session },
    );

    await auditRepository.log(
      {
        actorType: 'USER',
        actorId: input.staffId,
        action: 'payment.confirmed',
        entityType: 'Payment',
        entityId: payment._id.toString(),
        metadata: { amount: payment.amount, orderCount: orders.length },
      },
      session,
    );

    const payload = {
      tableSessionId: input.tableSessionId,
      status: 'CLOSED',
      version: closed.version,
    };
    const aggregate = {
      aggregateType: 'TableSession',
      aggregateId: input.tableSessionId,
      aggregateVersion: closed.version,
      payload,
    } as const;
    await outboxRepository.createRealtimeEvents(
      [
        {
          ...aggregate,
          eventType: 'payment.confirmed',
          target: { scope: 'session', tableSessionId: input.tableSessionId },
        },
        { ...aggregate, eventType: 'payment.confirmed', target: { scope: 'staff' } },
        { ...aggregate, eventType: 'tableSession.statusChanged', target: { scope: 'staff' } },
        { ...aggregate, eventType: 'serviceRequest.resolved', target: { scope: 'staff' } },
      ],
      session,
    );

    return {
      payment,
      orderIds: orders.map((o) => o._id.toString()),
      replayed: false as const,
      billId: bill._id.toString(),
      session: closed,
    };
  });

  return result;
}

export interface BillSummary {
  tableSessionId: string;
  tableCode: string;
  status: string;
  openedAt: Date;
  closedAt: Date | null;
  subtotal: number;
  total: number;
  paidAmount: number;
  orders: Array<
    Pick<
      OrderDoc,
      | '_id'
      | 'code'
      | 'total'
      | 'status'
      | 'paymentStatus'
      | 'items'
      | 'createdAt'
      | 'participantId'
    >
  >;
}

export async function buildBill(tableSessionId: string): Promise<BillSummary> {
  const session: TableSessionDoc | null = await tableSessionRepository.findById(tableSessionId);
  if (!session) throw new NotFoundError('Phiên không tồn tại.');

  // Phiên đã chốt Bill: trả snapshot bất biến thay vì tính lại từ Order (Order có thể đã đổi sau đó).
  if (session.status === 'CLOSED') {
    const snapshot = await billRepository.findBySession(tableSessionId);
    if (snapshot) {
      return {
        tableSessionId,
        tableCode: snapshot.tableCode,
        status: session.status,
        openedAt: snapshot.openedAt,
        closedAt: snapshot.closedAt,
        subtotal: snapshot.subtotal,
        total: snapshot.total,
        paidAmount: snapshot.paidAmount,
        orders: snapshot.orders.map((o) => ({
          _id: o.orderId,
          code: o.code,
          total: o.total,
          status: o.status,
          paymentStatus: o.paymentStatus,
          items: o.items,
          createdAt: o.createdAt,
          participantId: o.participantId,
        })) as BillSummary['orders'],
      };
    }
  }

  const table = await tableRepository.findById(session.tableId.toString());
  if (!table) throw new NotFoundError('Bàn không tồn tại.');
  const orders = await OrderModel.find({ tableSessionId }).sort({ createdAt: 1 });
  const paidOrders = orders.filter((o) => o.status === 'SERVED' && o.paymentStatus === 'PAID');
  const unpaid = orders.filter((o) => o.status === 'SERVED' && o.paymentStatus === 'UNPAID');
  const total = unpaid.reduce((s, o) => s + o.total, 0);
  const paidAmount = paidOrders.reduce((s, o) => s + o.total, 0);
  return {
    tableSessionId,
    tableCode: table.code,
    status: session.status,
    openedAt: session.startedAt,
    closedAt: session.closedAt ?? null,
    subtotal: orders.filter((o) => o.status !== 'CANCELLED').reduce((s, o) => s + o.total, 0),
    total,
    paidAmount,
    orders: orders
      .filter((o) => o.status !== 'CANCELLED')
      .map((o) => ({
        _id: o._id,
        code: o.code,
        total: o.total,
        status: o.status,
        paymentStatus: o.paymentStatus,
        items: o.items,
        createdAt: o.createdAt,
        participantId: o.participantId,
      })),
  };
}
