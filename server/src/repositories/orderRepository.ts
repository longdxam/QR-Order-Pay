import type { ClientSession } from 'mongoose';
import { OrderModel, type OrderDoc } from '../models/Order.js';
import type { OrderStatus, PaymentStatus } from '@may-cafe/contracts';

export interface OrderListFilters {
  tableSessionId?: string;
  participantId?: string;
  status?: OrderStatus | { $in: OrderStatus[] };
  paymentStatus?: PaymentStatus;
  from?: Date;
  to?: Date;
  page?: number;
  limit?: number;
}

export const orderRepository = {
  async createWithSession(data: Record<string, unknown>, session: ClientSession): Promise<OrderDoc> {
    const [doc] = await OrderModel.create([data], { session });
    if (!doc) throw new Error('Failed to create order');
    return doc;
  },
  async findById(id: string, session?: ClientSession | null): Promise<OrderDoc | null> {
    return OrderModel.findById(id, null, { session: session ?? undefined });
  },
  async findByCode(code: string): Promise<OrderDoc | null> {
    return OrderModel.findOne({ code });
  },
  async findByIdempotency(tableSessionId: string, idempotencyKey: string): Promise<OrderDoc | null> {
    return OrderModel.findOne({ tableSessionId, idempotencyKey });
  },
  async list(filters: OrderListFilters = {}): Promise<{ items: OrderDoc[]; total: number }> {
    const query: Record<string, unknown> = {};
    if (filters.tableSessionId) query.tableSessionId = filters.tableSessionId;
    if (filters.participantId) query.participantId = filters.participantId;
    if (filters.status) query.status = filters.status;
    if (filters.paymentStatus) query.paymentStatus = filters.paymentStatus;
    if (filters.from || filters.to) {
      const range: Record<string, Date> = {};
      if (filters.from) range.$gte = filters.from;
      if (filters.to) range.$lt = filters.to;
      query.createdAt = range;
    }
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const limit = filters.limit && filters.limit > 0 ? Math.min(filters.limit, 100) : 20;
    const [items, total] = await Promise.all([
      OrderModel.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      OrderModel.countDocuments(query),
    ]);
    return { items, total };
  },
  async listForStaff(filters: OrderListFilters = {}): Promise<OrderDoc[]> {
    const query: Record<string, unknown> = {};
    if (filters.status) query.status = filters.status;
    else query.status = { $in: ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED'] };
    if (filters.tableSessionId) query.tableSessionId = filters.tableSessionId;
    return OrderModel.find(query).sort({ createdAt: 1 });
  },
  async transitionStatus(
    id: string,
    expectedVersion: number,
    nextStatus: OrderStatus,
    entry: { from: OrderStatus; by?: string | null; byParticipantId?: string | null; reason?: string },
    session?: ClientSession | null,
  ): Promise<OrderDoc | null> {
    const push = {
      from: entry.from,
      to: nextStatus,
      at: new Date(),
      by: entry.by ?? null,
      byParticipantId: entry.byParticipantId ?? null,
      reason: entry.reason ?? '',
    };
    return OrderModel.findOneAndUpdate(
      { _id: id, status: entry.from, version: expectedVersion },
      { $set: { status: nextStatus, ...(nextStatus === 'CANCELLED' ? { cancelReason: entry.reason ?? '' } : {}) }, $push: { statusHistory: push }, $inc: { version: 1 } },
      { new: true, session: session ?? undefined },
    );
  },
  async setPaymentStatus(
    orderIds: string[],
    paymentStatus: PaymentStatus,
    session?: ClientSession | null,
  ): Promise<number> {
    const r = await OrderModel.updateMany(
      { _id: { $in: orderIds } },
      { $set: { paymentStatus } },
      { session: session ?? undefined },
    );
    return r.modifiedCount ?? 0;
  },
  async sumPaidTotal(from: Date, to: Date): Promise<number> {
    const agg = await OrderModel.aggregate([
      { $match: { createdAt: { $gte: from, $lt: to }, paymentStatus: 'PAID', status: { $ne: 'CANCELLED' } } },
      { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } },
    ]);
    return agg[0]?.total ?? 0;
  },
};
