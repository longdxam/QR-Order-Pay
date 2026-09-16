import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { productRepository } from '../repositories/productRepository.js';
import { toppingRepository } from '../repositories/toppingRepository.js';
import { orderRepository } from '../repositories/orderRepository.js';
import { tableSessionRepository } from '../repositories/tableSessionRepository.js';
import { unitOfWork } from '../infrastructure/unitOfWork.js';
import { auditRepository } from '../repositories/auditRepository.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors/AppError.js';
import type { OrderStatus } from '@may-cafe/contracts';
import { randomShortCode } from '../utils/crypto.js';
import { guestCanOrder } from './tableSessionService.js';
import type { OrderDoc } from '../models/Order.js';
import { TableSessionModel } from '../models/TableSession.js';

export interface PlaceOrderItemInput {
  productId: string;
  variantId: string | null;
  sugarLevel: string;
  iceLevel: string;
  toppingIds: string[];
  note?: string;
  quantity: number;
}

export interface PlaceOrderInput {
  tableSessionId: string;
  participantId: string;
  idempotencyKey: string;
  items: PlaceOrderItemInput[];
  note?: string;
}

const MAX_QUANTITY = 50;

export async function placeOrder(input: PlaceOrderInput): Promise<{ order: OrderDoc; created: boolean }> {
  const idempotencyKey = input.idempotencyKey?.slice(0, 64);
  if (!idempotencyKey) throw new ValidationError('Thiếu idempotency key.');
  if (!Array.isArray(input.items) || input.items.length === 0) throw new ValidationError('Đơn hàng cần ít nhất một món.');
  for (const it of input.items) {
    if (!Number.isInteger(it.quantity) || it.quantity < 1 || it.quantity > MAX_QUANTITY) {
      throw new ValidationError('Số lượng mỗi món phải là số nguyên từ 1 đến 50.');
    }
  }
  await guestCanOrder(input.tableSessionId);

  const existing = await orderRepository.findByIdempotency(input.tableSessionId, idempotencyKey);
  if (existing) {
    const expectedHash = hashRequest({ items: input.items, note: input.note, participantId: input.participantId });
    if (existing.requestHash !== expectedHash) {
      throw new ConflictError(
        'IDEMPOTENCY_CONFLICT',
        'Idempotency key đã được dùng với nội dung khác, vui lòng tạo yêu cầu mới.',
      );
    }
    if (existing.participantId !== input.participantId) {
      throw new ConflictError('IDEMPOTENCY_CONFLICT', 'Idempotency key không thuộc về phiên này.');
    }
    return { order: existing, created: false };
  }

  const productIds = [...new Set(input.items.map((i) => i.productId))];
  const toppingIds = [...new Set(input.items.flatMap((i) => i.toppingIds))];
  const [products, toppings, session] = await Promise.all([
    productRepository.findManyByIds(productIds),
    toppingIds.length > 0 ? toppingRepository.findManyByIds(toppingIds) : Promise.resolve([]),
    tableSessionRepository.findById(input.tableSessionId),
  ]);
  if (!session) throw new NotFoundError('Phiên không tồn tại.');
  if (!['OPEN'].includes(session.status))
    throw new ForbiddenError('Phiên không ở trạng thái mở, không thể đặt món.');

  const productMap = new Map(products.map((p) => [p._id.toString(), p]));
  const toppingMap = new Map(toppings.map((t) => [t._id.toString(), t]));

  const unavailable: string[] = [];
  const invalidOptions: string[] = [];

  const snapshotItems = input.items.map((item, idx) => {
    const product = productMap.get(item.productId);
    if (!product || product.isArchived || !product.isAvailable) {
      unavailable.push(item.productId);
      return null;
    }
    const variant = item.variantId ? product.variants.find((v) => v._id?.toString() === item.variantId) : null;
    if (item.variantId && !variant) {
      invalidOptions.push(`item#${idx}:variant`);
      return null;
    }
    if ((product.variants.length > 0 && !variant) || variant?.isAvailable === false) {
      invalidOptions.push(`item#${idx}:variant-unavailable`);
    }
    if (new Set(item.toppingIds).size !== item.toppingIds.length) invalidOptions.push(`item#${idx}:duplicate-topping`);
    if (item.variantId && !product.allowedOptions.sizes?.includes(variant?.name ?? '')) {
      invalidOptions.push(`item#${idx}:variant-size`);
    }
    if (!product.allowedOptions.sugarLevels?.includes(item.sugarLevel)) {
      invalidOptions.push(`item#${idx}:sugar`);
    }
    if (!product.allowedOptions.iceLevels?.includes(item.iceLevel)) {
      invalidOptions.push(`item#${idx}:ice`);
    }
    let unitPrice = (variant?.price ?? product.basePrice) ?? 0;
    for (const tid of item.toppingIds) {
      const topping = toppingMap.get(tid);
      if (!topping || topping.isArchived || !topping.isAvailable || !product.allowedOptions.toppingIds.map(String).includes(tid)) {
        invalidOptions.push(`item#${idx}:topping-${tid}`);
        continue;
      }
      unitPrice += topping.price;
    }
    return {
      productId: product._id,
      variantId: variant?._id ?? null,
      sizeName: variant?.name ?? null,
      sugarLevel: item.sugarLevel,
      iceLevel: item.iceLevel,
      toppingIds: item.toppingIds.map((id) => new mongoose.Types.ObjectId(id)),
      toppingNamesSnapshot: item.toppingIds.map((id) => toppingMap.get(id)?.name ?? ''),
      note: (item.note ?? '').slice(0, 280),
      quantity: item.quantity,
      unitPrice,
      lineTotal: unitPrice * item.quantity,
      nameSnapshot: product.name,
      variantNameSnapshot: variant?.name ?? '',
    };
  });

  if (unavailable.length > 0) {
    throw new ConflictError(
      'PRODUCT_UNAVAILABLE',
      'Một món vừa hết hoặc không khả dụng. Vui lòng cập nhật giỏ hàng.',
      { unavailable },
    );
  }
  if (invalidOptions.length > 0) {
    throw new ValidationError('Tùy chọn món không hợp lệ.', { invalidOptions });
  }

  const total = snapshotItems.reduce((s, it) => s + (it?.lineTotal ?? 0), 0);
  const code = await generateUniqueCode();

  const result = await unitOfWork.withTransaction(async (mongoSession) => {
    const open = await TableSessionModel.findOneAndUpdate(
      { _id: input.tableSessionId, status: 'OPEN' }, { $inc: { version: 1 } }, { session: mongoSession },
    );
    if (!open) throw new ForbiddenError('Phiên đang thanh toán hoặc đã đóng, không thể đặt thêm món.');
    const order = await orderRepository.createWithSession(
      {
        code,
        tableSessionId: session._id,
        participantId: input.participantId,
        tableId: session.tableId,
        items: snapshotItems.map((it) => ({ ...it })),
        total,
        status: 'PENDING' as OrderStatus,
        paymentStatus: 'UNPAID' as const,
        statusHistory: [{ from: null, to: 'PENDING', at: new Date(), byParticipantId: input.participantId }],
        idempotencyKey,
        requestHash: hashRequest({ items: input.items, note: input.note, participantId: input.participantId }),
        version: 0,
        cancelReason: '',
      },
      mongoSession,
    );
    return order;
  });

  await auditRepository.log({
    actorType: 'GUEST',
    participantId: input.participantId,
    action: 'order.placed',
    entityType: 'Order',
    entityId: result._id.toString(),
    metadata: { code: result.code, total: result.total },
  });

  return { order: result, created: true };
}

function hashRequest(payload: { items: PlaceOrderItemInput[]; note?: string; participantId: string }): string {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function generateUniqueCode(): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const code = `MC${randomShortCode(5)}`;
    const exists = await orderRepository.findByCode(code);
    if (!exists) return code;
  }
  // extremely unlikely fallback
  return `MC${Date.now().toString(36).toUpperCase()}`;
}

export async function cancelOrderByGuest(orderId: string, participantId: string): Promise<OrderDoc> {
  const order = await orderRepository.findById(orderId);
  if (!order) throw new NotFoundError('Đơn không tồn tại.');
  if (order.participantId !== participantId)
    throw new ForbiddenError('Bạn không thể hủy đơn của khách khác.');
  if (order.status !== 'PENDING')
    throw new ConflictError('STATE_TRANSITION_INVALID', 'Đơn đã được nhận, không thể hủy.');
  const updated = await orderRepository.transitionStatus(orderId, order.version, 'CANCELLED', {
    from: 'PENDING',
    byParticipantId: participantId,
    reason: 'Khách hủy',
  });
  if (!updated) throw new ConflictError('CONFLICT', 'Đơn vừa được cập nhật, vui lòng tải lại.');
  await auditRepository.log({
    actorType: 'GUEST',
    participantId,
    action: 'order.cancelled',
    entityType: 'Order',
    entityId: orderId,
  });
  return updated;
}

export async function transitionByStaff(orderId: string, next: OrderStatus, actor: { id: string }, reason?: string): Promise<OrderDoc> {
  const order = await orderRepository.findById(orderId);
  if (!order) throw new NotFoundError('Đơn không tồn tại.');
  const allowed = allowedNext(order.status);
  if (!allowed.includes(next)) {
    throw new ConflictError(
      'STATE_TRANSITION_INVALID',
      `Không thể chuyển đơn từ ${order.status} sang ${next}.`,
    );
  }
  const updated = await orderRepository.transitionStatus(orderId, order.version, next, {
    from: order.status,
    by: actor.id,
    reason,
  });
  if (!updated) throw new ConflictError('CONFLICT', 'Đơn vừa được cập nhật bởi người khác, vui lòng tải lại.');
  await auditRepository.log({
    actorType: 'USER',
    actorId: actor.id,
    action: 'order.transition',
    entityType: 'Order',
    entityId: orderId,
    metadata: { from: order.status, to: next, reason },
  });
  return updated;
}

function allowedNext(from: OrderStatus): OrderStatus[] {
  if (from === 'PENDING') return ['CONFIRMED', 'CANCELLED'];
  if (from === 'CONFIRMED') return ['PREPARING', 'CANCELLED'];
  if (from === 'PREPARING') return ['READY'];
  if (from === 'READY') return ['SERVED'];
  return [];
}

export async function getOrderForGuest(orderId: string, participantId: string): Promise<OrderDoc> {
  const order = await orderRepository.findById(orderId);
  if (!order) throw new NotFoundError('Đơn không tồn tại.');
  if (order.participantId !== participantId)
    throw new ForbiddenError('Bạn không thể xem đơn của khách khác.');
  return order;
}

export async function listOrdersForGuest(participantId: string, tableSessionId?: string): Promise<OrderDoc[]> {
  return (await orderRepository.list({ participantId, tableSessionId, limit: 50 })).items;
}
