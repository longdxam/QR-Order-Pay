import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import { OrderModel, type OrderDoc } from '../models/Order.js';
import type { OrderStatus, PaymentStatus } from '@may-cafe/contracts';
import { settleOrderInventory } from '../services/orderInventoryService.js';
import { settleOrderBenefits } from '../services/promotionService.js';

export const UNFINISHED_ORDER_STATUSES: OrderStatus[] = [
  'PENDING',
  'CONFIRMED',
  'PREPARING',
  'READY',
];

const PAID_LIVE = {
  paymentStatus: 'PAID',
  status: { $in: ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED'] },
};

export interface StaffOrderFeedFilters {
  tableSessionIds: string[];
  status?: OrderStatus;
}

/** Shared scope for KDS and operational counters; aggregate pipelines need real ObjectIds. */
export function staffOrderFeedQuery(
  filters: StaffOrderFeedFilters,
  now = new Date(),
): FilterQuery<OrderDoc> {
  return {
    $or: [
      { tableSessionId: { $in: filters.tableSessionIds.map((id) => new Types.ObjectId(id)) } },
      {
        fulfillmentType: { $in: ['TAKEAWAY', 'PICKUP'] },
        'pickup.outcome': 'ACTIVE',
        $or: [
          { 'pickup.scheduledAt': null },
          { 'pickup.scheduledAt': { $lte: new Date(now.getTime() + 15 * 60000) } },
        ],
      },
    ],
    paymentStatus: 'PAID',
    status: filters.status ?? { $in: UNFINISHED_ORDER_STATUSES },
  };
}

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

export interface PaidOrderAnalytics {
  totalRevenue: number;
  orderCount: number;
  averageOrderValue: number;
  topProducts: Array<{ productId: string; name: string; quantity: number; revenue: number }>;
  revenueByDay: Array<{ date: string; revenue: number; orders: number }>;
  revenueByHour: Array<{ hour: number; revenue: number }>;
}

export const orderRepository = {
  async createWithSession(
    data: Record<string, unknown>,
    session: ClientSession,
  ): Promise<OrderDoc> {
    const [doc] = await OrderModel.create([data], { session });
    if (!doc) throw new Error('Failed to create order');
    return doc;
  },
  async findById(
    id: string | Types.ObjectId,
    session?: ClientSession | null,
  ): Promise<OrderDoc | null> {
    return OrderModel.findById(id, null, { session: session ?? undefined });
  },
  async findByCode(code: string): Promise<OrderDoc | null> {
    return OrderModel.findOne({ code });
  },
  async findByIdempotency(
    tableSessionId: string,
    idempotencyKey: string,
  ): Promise<OrderDoc | null> {
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
  /** Dine-in cancellations, including legacy orders and closed table sessions. */
  async listRecentCancellations(): Promise<OrderDoc[]> {
    const since = new Date(Date.now() - 24 * 60 * 60_000);
    return OrderModel.find({
      status: 'CANCELLED',
      fulfillmentType: { $nin: ['TAKEAWAY', 'PICKUP'] },
      updatedAt: { $gte: since },
      statusHistory: { $elemMatch: { to: 'CANCELLED', at: { $gte: since } } },
    })
      .sort({ updatedAt: -1, _id: -1 })
      .limit(50);
  },
  /** Feed KDS: chỉ đơn của các phiên đang hoạt động, nên không phình theo lịch sử. */
  async listForStaff(filters: StaffOrderFeedFilters): Promise<OrderDoc[]> {
    return OrderModel.find(staffOrderFeedQuery(filters)).sort({ createdAt: 1 });
  },
  async transitionStatus(
    id: string,
    expectedVersion: number,
    nextStatus: OrderStatus,
    entry: {
      from: OrderStatus;
      by?: string | null;
      byParticipantId?: string | null;
      reason?: string;
    },
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
    const updated = await OrderModel.findOneAndUpdate(
      { _id: id, status: entry.from, version: expectedVersion },
      {
        $set: {
          status: nextStatus,
          ...(nextStatus === 'CANCELLED' ? { cancelReason: entry.reason ?? '' } : {}),
        },
        $push: { statusHistory: push },
        $inc: { version: 1 },
      },
      { new: true, session: session ?? undefined },
    );
    if (updated && session)
      await settleOrderInventory(updated, nextStatus, entry.by ?? null, session);
    if (updated && session) await settleOrderBenefits(updated, nextStatus, session);
    return updated;
  },
  /** Mọi đơn của một phiên bàn (kể cả đã hủy), cũ trước. */
  async listBySession(tableSessionId: string, session?: ClientSession | null): Promise<OrderDoc[]> {
    return OrderModel.find({ tableSessionId }, null, { session: session ?? undefined }).sort({
      createdAt: 1,
    });
  },
  /** Đơn chưa thu đủ tiền và chưa hủy trong các phiên cho trước, cũ trước. */
  async listUnpaidInSessions(tableSessionIds: Types.ObjectId[]): Promise<OrderDoc[]> {
    return OrderModel.find({
      tableSessionId: { $in: tableSessionIds },
      status: { $ne: 'CANCELLED' },
      paymentStatus: 'UNPAID',
    }).sort({ createdAt: 1 });
  },
  /**
   * Ghi nhận tiền thu cho một đơn bằng optimistic lock (`version` + còn UNPAID). Thu đủ thì đơn thành
   * PAID và, nếu đang AWAITING_PAYMENT, chuyển sang PENDING để vào KDS. Trả null nếu đơn vừa bị đổi.
   */
  async recordPayment(
    order: OrderDoc,
    paidAmount: number,
    staffId: string,
    session: ClientSession,
  ): Promise<OrderDoc | null> {
    const paid = paidAmount === order.total;
    const nextStatus = paid && order.status === 'AWAITING_PAYMENT' ? 'PENDING' : order.status;
    return OrderModel.findOneAndUpdate(
      { _id: order._id, version: order.version, paymentStatus: 'UNPAID' },
      {
        $set: { paidAmount, paymentStatus: paid ? 'PAID' : 'UNPAID', status: nextStatus },
        $inc: { version: 1 },
        ...(nextStatus !== order.status
          ? {
              $push: {
                statusHistory: {
                  from: order.status,
                  to: nextStatus,
                  at: new Date(),
                  by: staffId,
                  reason: 'Đã nhận đủ tiền',
                },
              },
            }
          : {}),
      },
      { new: true, session },
    );
  },
  /** Thu gộp cuối phiên: đánh dấu từng đơn đã thu đủ tổng tiền. */
  async markFullyPaid(orders: OrderDoc[], session: ClientSession): Promise<void> {
    if (orders.length === 0) return;
    await OrderModel.bulkWrite(
      orders.map((order) => ({
        updateOne: {
          filter: { _id: order._id },
          update: {
            $set: { paymentStatus: 'PAID' as const, paidAmount: order.total },
            $inc: { version: 1 },
          },
        },
      })),
      { session },
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
      {
        $match: {
          createdAt: { $gte: from, $lt: to },
          paymentStatus: 'PAID',
          status: { $ne: 'CANCELLED' },
        },
      },
      { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } },
    ]);
    return agg[0]?.total ?? 0;
  },
  async paidAnalytics(from: Date, to: Date): Promise<PaidOrderAnalytics> {
    const [result] = await OrderModel.aggregate<{
      summary: Array<{ totalRevenue: number; orderCount: number; averageOrderValue: number }>;
      topProducts: PaidOrderAnalytics['topProducts'];
      revenueByDay: PaidOrderAnalytics['revenueByDay'];
      revenueByHour: PaidOrderAnalytics['revenueByHour'];
    }>([
      {
        $match: {
          createdAt: { $gte: from, $lt: to },
          paymentStatus: 'PAID',
          status: { $ne: 'CANCELLED' },
        },
      },
      {
        $facet: {
          summary: [
            {
              $group: {
                _id: null,
                totalRevenue: { $sum: '$total' },
                orderCount: { $sum: 1 },
                averageOrderValue: { $avg: '$total' },
              },
            },
            {
              $project: {
                _id: 0,
                totalRevenue: 1,
                orderCount: 1,
                averageOrderValue: { $round: ['$averageOrderValue', 0] },
              },
            },
          ],
          topProducts: [
            { $unwind: '$items' },
            {
              $group: {
                _id: '$items.productId',
                name: { $last: '$items.nameSnapshot' },
                quantity: { $sum: '$items.quantity' },
                revenue: { $sum: '$items.lineTotal' },
              },
            },
            { $sort: { quantity: -1, revenue: -1 } },
            { $limit: 5 },
            {
              $project: {
                _id: 0,
                productId: { $toString: '$_id' },
                name: 1,
                quantity: 1,
                revenue: 1,
              },
            },
          ],
          revenueByDay: [
            {
              $group: {
                _id: {
                  $dateToString: {
                    date: '$createdAt',
                    format: '%Y-%m-%d',
                    timezone: 'Asia/Ho_Chi_Minh',
                  },
                },
                revenue: { $sum: '$total' },
                orders: { $sum: 1 },
              },
            },
            { $sort: { _id: 1 } },
            { $project: { _id: 0, date: '$_id', revenue: 1, orders: 1 } },
          ],
          revenueByHour: [
            {
              $group: {
                _id: {
                  $toInt: {
                    $dateToString: {
                      date: '$createdAt',
                      format: '%H',
                      timezone: 'Asia/Ho_Chi_Minh',
                    },
                  },
                },
                revenue: { $sum: '$total' },
              },
            },
            { $sort: { _id: 1 } },
            { $project: { _id: 0, hour: '$_id', revenue: 1 } },
          ],
        },
      },
    ]);
    const summary = result?.summary[0];
    return {
      totalRevenue: summary?.totalRevenue ?? 0,
      orderCount: summary?.orderCount ?? 0,
      averageOrderValue: summary?.averageOrderValue ?? 0,
      topProducts: result?.topProducts ?? [],
      revenueByDay: result?.revenueByDay ?? [],
      revenueByHour: result?.revenueByHour ?? [],
    };
  },
  /** Số đơn đã trả tiền, chưa hủy theo (thứ ISO, giờ) giờ Việt Nam trong [from, until). */
  async paidCountsByWeekdayHour(from: Date, until: Date) {
    return OrderModel.aggregate<{ _id: { day: number; hour: number }; count: number }>([
      {
        $match: {
          createdAt: { $gte: from, $lt: until },
          paymentStatus: 'PAID',
          status: { $ne: 'CANCELLED' },
        },
      },
      {
        $group: {
          _id: {
            day: { $isoDayOfWeek: { date: '$createdAt', timezone: 'Asia/Ho_Chi_Minh' } },
            hour: { $hour: { date: '$createdAt', timezone: 'Asia/Ho_Chi_Minh' } },
          },
          count: { $sum: 1 },
        },
      },
    ]);
  },
  /** Phiên còn đơn chưa hủy, hoặc là bàn nhận của đơn quà chưa giao: chưa được tự đóng. */
  async sessionHasLiveOrder(tableSessionId: Types.ObjectId, session: ClientSession) {
    return OrderModel.exists({
      $or: [
        { tableSessionId, status: { $ne: 'CANCELLED' } },
        { 'gift.recipientSessionId': tableSessionId, status: { $nin: ['SERVED', 'CANCELLED'] } },
      ],
    }).session(session);
  },
  async listServedPaidForParticipant(tableSessionId: string, participantId: string) {
    return OrderModel.find({
      tableSessionId,
      participantId,
      paymentStatus: 'PAID',
      status: 'SERVED',
    })
      .sort({ createdAt: 1 })
      .lean();
  },
  async countAwaitingPayment(
    tableSessionId: string,
    participantId: string,
    session: ClientSession,
  ): Promise<number> {
    return OrderModel.countDocuments({
      tableSessionId,
      participantId,
      status: 'AWAITING_PAYMENT',
    }).session(session);
  },
  /** Mốc tạo và lịch sử trạng thái của đơn (trừ đơn hẹn không đến) để phát hiện bất thường. */
  async listStatusTimelineSince(since: Date) {
    return OrderModel.find({
      'pickup.outcome': { $ne: 'NO_SHOW' },
      $or: [
        { createdAt: { $gte: since } },
        { 'statusHistory.at': { $gte: since } },
        { status: 'PREPARING' },
      ],
    })
      .select('createdAt status statusHistory')
      .lean();
  },
  /** Số đơn và đơn cũ nhất theo trạng thái trong phạm vi cho trước. */
  async countByStatus(scope: FilterQuery<OrderDoc>) {
    return OrderModel.aggregate<{ _id: string; count: number; oldestCreatedAt: Date }>([
      { $match: scope },
      { $group: { _id: '$status', count: { $sum: 1 }, oldestCreatedAt: { $min: '$createdAt' } } },
    ]);
  },
  async clearPaidAmount(orderId: Types.ObjectId, session: ClientSession): Promise<void> {
    await OrderModel.updateOne({ _id: orderId }, { $set: { paidAmount: 0 } }, { session });
  },
  async saveInventoryState(order: OrderDoc, session: ClientSession): Promise<void> {
    await OrderModel.updateOne(
      { _id: order._id },
      { $set: { inventoryState: order.inventoryState } },
      { session },
    );
  },
  /** Tăng version nếu đơn chưa đổi (khóa lạc quan); trả về có khớp hay không. */
  async bumpVersion(order: OrderDoc, session: ClientSession): Promise<boolean> {
    const guarded = await OrderModel.updateOne(
      { _id: order._id, version: order.version },
      { $inc: { version: 1 } },
      { session },
    );
    return guarded.modifiedCount === 1;
  },
  /** Phiên là bàn nhận của đơn quà chưa giao xong. */
  async hasUndeliveredGiftFor(tableSessionId: string, session: ClientSession): Promise<boolean> {
    return !!(await OrderModel.exists({
      'gift.recipientSessionId': tableSessionId,
      status: { $nin: ['SERVED', 'CANCELLED'] },
    }).session(session));
  },
  /** Phiên đã gửi một đơn quà chưa giao xong. */
  async hasUndeliveredGiftFrom(tableSessionId: string, session: ClientSession): Promise<boolean> {
    return !!(await OrderModel.exists({
      tableSessionId,
      gift: { $ne: null },
      status: { $nin: ['SERVED', 'CANCELLED'] },
    }).session(session));
  },
  /** Phiên còn đơn chưa giao xong (không tính đơn đã hủy). */
  async hasUnfinished(tableSessionId: string, session: ClientSession): Promise<boolean> {
    return !!(await OrderModel.exists({
      tableSessionId,
      status: { $nin: ['SERVED', 'CANCELLED'] },
    }).session(session));
  },
  /** Phiên còn đơn chưa hủy mà chưa thu tiền. */
  async hasUnpaid(tableSessionId: string, session: ClientSession): Promise<boolean> {
    return !!(await OrderModel.exists({
      tableSessionId,
      status: { $ne: 'CANCELLED' },
      paymentStatus: 'UNPAID',
    }).session(session));
  },
  async moveSessionToTable(
    tableSessionId: Types.ObjectId,
    tableId: Types.ObjectId,
    session: ClientSession,
  ): Promise<void> {
    await OrderModel.updateMany({ tableSessionId }, { $set: { tableId } }, { session });
  },
  /** Tăng version để mọi thao tác tiền khác trên đơn này phải xếp hàng sau transaction hiện tại. */
  async touchVersion(orderId: Types.ObjectId, session: ClientSession): Promise<void> {
    await OrderModel.updateOne({ _id: orderId }, { $inc: { version: 1 } }, { session });
  },
  /** Đơn mang đi/đặt trước thuộc tính năng đã gỡ, chỉ còn trong lịch sử. */
  async listRetiredFulfillmentIds() {
    return OrderModel.distinct('_id', { fulfillmentType: { $in: ['TAKEAWAY', 'PICKUP'] } });
  },
  /** Đơn tại bàn đang chờ thu tiền có thể nhận khoản thu chuyển sang (tối đa 200). */
  async listTransferTargets(excludeIds: unknown[]) {
    return OrderModel.find({
      _id: { $nin: excludeIds },
      status: 'AWAITING_PAYMENT',
      paymentStatus: 'UNPAID',
    })
      .select('code tableId total paidAmount createdAt')
      .populate('tableId', 'name')
      .limit(200)
      .lean();
  },
  /** Mã đơn, loại phục vụ và tên bàn để hiển thị cạnh khoản thu. */
  async listLabels(ids: unknown[]) {
    return OrderModel.find({ _id: { $in: ids } })
      .select('code tableId fulfillmentType createdAt')
      .populate('tableId', 'name');
  },
  /** Đơn đã thanh toán và chưa hủy (in ảnh cốc của món). */
  async findPaidLive(id: string, session?: ClientSession | null) {
    return OrderModel.findOne({ _id: id, ...PAID_LIVE }).session(session ?? null);
  },
  /** Đơn đã thanh toán có món kèm ảnh cốc, 20 đơn mới nhất mỗi trang. */
  async pageWithCupPhotos(page: number) {
    const filter = { ...PAID_LIVE, 'items.cupPhotoId': { $type: 'objectId' } };
    const total = await OrderModel.countDocuments(filter),
      orders = await OrderModel.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * 20)
        .limit(20);
    return { total, orders };
  },
  async listStatuses(ids: unknown[]) {
    return OrderModel.find({ _id: { $in: ids } }).select('status');
  },
};
