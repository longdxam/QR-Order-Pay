import type { ClientSession, Types } from 'mongoose';
import mongoose from 'mongoose';
import { PaymentModel } from '../models/Payment.js';

export interface LedgerEventFacets {
  summary: Array<{
    grossCollected: number;
    totalRefunded: number;
    adjustmentAmount: number;
    totalRevenue: number;
    eventCount: number;
  }>;
  revenueByDay: Array<{ date: string; revenue: number; orders: number }>;
  revenueByHour: Array<{ hour: number; revenue: number }>;
  count: Array<{ value: number }>;
  revenueByMethod: Array<{
    method: string;
    revenue: number;
    collected: number;
    refunded: number;
    adjustment: number;
  }>;
}

export const paymentRepository = {
  async create(data: Record<string, unknown>, session?: ClientSession | null) {
    const [doc] = await PaymentModel.create([data], { session: session ?? undefined });
    if (!doc) throw new Error('Failed to create payment');
    return doc;
  },
  async findByIdempotency(key: string) {
    return PaymentModel.findOne({ idempotencyKey: key });
  },
  async listBySession(tableSessionId: string, session?: ClientSession | null) {
    return PaymentModel.find({ tableSessionId }, null, { session: session ?? undefined }).sort({
      paidAt: -1,
    });
  },
  async sumPaidBySession(tableSessionId: string): Promise<number> {
    const agg = await PaymentModel.aggregate([
      {
        $match: { tableSessionId: new mongoose.Types.ObjectId(tableSessionId), status: 'SUCCESS' },
      },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    return agg[0]?.total ?? 0;
  },
  /**
   * Sổ thu/hoàn/điều chỉnh trong [from, to) theo giờ Việt Nam: tổng hợp, theo ngày, giờ, phương thức
   * và số đơn có khoản thu.
   */
  async ledgerEventFacets(from: Date, to: Date): Promise<LedgerEventFacets | undefined> {
    const [result] = await PaymentModel.aggregate<LedgerEventFacets>([
      {
        $project: {
          orderIds: 1,
          events: {
            $concatArrays: [
              [
                {
                  at: '$paidAt',
                  method: '$method',
                  amount: '$amount',
                  kind: {
                    $cond: [{ $ifNull: ['$replacesPaymentId', false] }, 'ADJUSTMENT', 'COLLECTION'],
                  },
                },
              ],
              {
                $cond: [
                  { $eq: ['$status', 'REFUNDED'] },
                  [
                    {
                      at: '$refundedAt',
                      method: { $ifNull: ['$refundMethod', '$method'] },
                      amount: { $multiply: ['$amount', -1] },
                      kind: {
                        $cond: [{ $ifNull: ['$reversalKind', false] }, 'ADJUSTMENT', 'REFUND'],
                      },
                    },
                  ],
                  [],
                ],
              },
            ],
          },
        },
      },
      { $unwind: '$events' },
      { $match: { 'events.at': { $gte: from, $lt: to } } },
      {
        $facet: {
          revenueByMethod: [
            {
              $group: {
                _id: { $ifNull: ['$events.method', 'UNKNOWN'] },
                revenue: { $sum: '$events.amount' },
                collected: {
                  $sum: { $cond: [{ $eq: ['$events.kind', 'COLLECTION'] }, '$events.amount', 0] },
                },
                refunded: {
                  $sum: {
                    $cond: [
                      { $eq: ['$events.kind', 'REFUND'] },
                      { $multiply: ['$events.amount', -1] },
                      0,
                    ],
                  },
                },
                adjustment: {
                  $sum: { $cond: [{ $eq: ['$events.kind', 'ADJUSTMENT'] }, '$events.amount', 0] },
                },
              },
            },
            {
              $project: {
                _id: 0,
                method: '$_id',
                revenue: 1,
                collected: 1,
                refunded: 1,
                adjustment: 1,
              },
            },
            { $sort: { method: 1 } },
          ],
          summary: [
            {
              $group: {
                _id: null,
                grossCollected: {
                  $sum: { $cond: [{ $eq: ['$events.kind', 'COLLECTION'] }, '$events.amount', 0] },
                },
                totalRefunded: {
                  $sum: {
                    $cond: [
                      { $eq: ['$events.kind', 'REFUND'] },
                      { $multiply: ['$events.amount', -1] },
                      0,
                    ],
                  },
                },
                adjustmentAmount: {
                  $sum: { $cond: [{ $eq: ['$events.kind', 'ADJUSTMENT'] }, '$events.amount', 0] },
                },
                totalRevenue: { $sum: '$events.amount' },
                eventCount: { $sum: 1 },
              },
            },
          ],
          revenueByDay: [
            {
              $group: {
                _id: {
                  $dateToString: {
                    date: '$events.at',
                    format: '%Y-%m-%d',
                    timezone: 'Asia/Ho_Chi_Minh',
                  },
                },
                revenue: { $sum: '$events.amount' },
                orders: {
                  $addToSet: {
                    $cond: [{ $eq: ['$events.kind', 'COLLECTION'] }, '$orderIds', '$$REMOVE'],
                  },
                },
              },
            },
            {
              $project: {
                _id: 0,
                date: '$_id',
                revenue: 1,
                orders: {
                  $size: {
                    $reduce: {
                      input: '$orders',
                      initialValue: [],
                      in: { $setUnion: ['$$value', '$$this'] },
                    },
                  },
                },
              },
            },
            { $sort: { date: 1 } },
          ],
          revenueByHour: [
            {
              $group: {
                _id: { $hour: { date: '$events.at', timezone: 'Asia/Ho_Chi_Minh' } },
                revenue: { $sum: '$events.amount' },
              },
            },
            { $project: { _id: 0, hour: '$_id', revenue: 1 } },
            { $sort: { hour: 1 } },
          ],
          count: [
            { $match: { 'events.kind': 'COLLECTION' } },
            { $unwind: '$orderIds' },
            { $group: { _id: '$orderIds' } },
            { $count: 'value' },
          ],
        },
      },
    ]);
    return result;
  },
  async listSuccessfulForOrder(orderId: Types.ObjectId, session: ClientSession) {
    return PaymentModel.find({ orderIds: orderId, status: 'SUCCESS' }).session(session);
  },
  /** Tiền mặt đã thu trong ca (kể cả khoản sau đó hoàn). */
  async cashCollectedInShift(shiftId: unknown, session: ClientSession) {
    const [row] = await PaymentModel.aggregate<{ total: number }>([
      { $match: { shiftId, status: { $in: ['SUCCESS', 'REFUNDED'] }, method: 'CASH' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]).session(session);
    return row;
  },
  /** Tiền mặt đã hoàn ra trong ca. */
  async cashRefundedInShift(shiftId: unknown, session: ClientSession) {
    const [row] = await PaymentModel.aggregate<{ total: number }>([
      { $match: { refundShiftId: shiftId, status: 'REFUNDED', refundMethod: 'CASH' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]).session(session);
    return row;
  },
  async collectedByMethodInShift(shiftId: unknown) {
    return PaymentModel.aggregate<{ _id: string; total: number; count: number }>([
      { $match: { shiftId, status: { $in: ['SUCCESS', 'REFUNDED'] } } },
      { $group: { _id: '$method', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]);
  },
  /**
   * Tiền hoàn ra trong ca theo phương thức hoàn. `reversals` = true: chỉ các bút toán đảo do điều
   * chỉnh (VOID/METHOD/TRANSFER); false: chỉ hoàn tiền thật cho khách.
   */
  async refundedByMethodInShift(shiftId: unknown, reversals: boolean) {
    return PaymentModel.aggregate<{ _id: string; total: number; count: number }>([
      {
        $match: {
          refundShiftId: shiftId,
          status: 'REFUNDED',
          reversalKind: reversals ? { $in: ['VOID', 'METHOD', 'TRANSFER'] } : null,
        },
      },
      { $group: { _id: '$refundMethod', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]);
  },
  async findById(id: unknown, session: ClientSession) {
    return PaymentModel.findById(id).session(session);
  },
  async listIdsForOrder(orderId: unknown, session: ClientSession) {
    return PaymentModel.find({ orderIds: orderId }).select('_id').session(session);
  },
  async listIdsForOrders(orderIds: unknown[]) {
    return PaymentModel.distinct('_id', { orderIds: { $in: orderIds } });
  },
  async listByIds(ids: unknown[]) {
    return PaymentModel.find({ _id: { $in: ids } });
  },
  /** Khoản thu mới nhất trước. */
  async page(filter: Record<string, unknown>, page: number, limit: number) {
    return PaymentModel.find(filter)
      .sort({ paidAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit);
  },
  async count(filter: Record<string, unknown>) {
    return PaymentModel.countDocuments(filter);
  },
};
