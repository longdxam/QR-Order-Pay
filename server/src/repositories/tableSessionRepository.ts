import type { ClientSession, Types } from 'mongoose';
import { TableSessionModel, type TableSessionDoc } from '../models/TableSession.js';
import { ConflictError } from '../errors/AppError.js';
import { completeSessionReservation } from '../services/reservationGuards.js';

export interface UnpaidSessionSummary {
  id: string;
  tableCode: string;
  tableName: string;
  status: string;
  startedAt: Date;
  unpaidTotal: number;
}

export interface ITableSessionRepository {
  findActiveByTable(
    tableId: string,
    session?: ClientSession | null,
  ): Promise<TableSessionDoc | null>;
  findById(id: string, session?: ClientSession | null): Promise<TableSessionDoc | null>;
  create(
    data: { tableId: string; openedBy?: string | null; source?: 'STAFF' | 'GUEST' },
    session?: ClientSession | null,
  ): Promise<TableSessionDoc>;
  updateStatus(
    id: string,
    expectedVersion: number,
    update: {
      status: 'OPEN' | 'CHECKOUT' | 'CLOSED';
      closedBy?: string | null;
      closedReason?: 'PAID' | 'STAFF' | 'IDLE' | null;
      billId?: string | null;
    },
    session?: ClientSession | null,
  ): Promise<TableSessionDoc | null>;
  listOpen(): Promise<TableSessionDoc[]>;
  listIdleCandidates(cutoff: Date): Promise<TableSessionDoc[]>;
  lockOpen(id: unknown, session: ClientSession): Promise<TableSessionDoc | null>;
  listActiveIds(): Promise<Array<{ _id: Types.ObjectId }>>;
  lockForRefund(
    id: Types.ObjectId,
    actorId: string,
    session: ClientSession,
  ): Promise<TableSessionDoc | null>;
  isOpen(id: unknown, session?: ClientSession | null): Promise<boolean>;
  attachBill(id: string, billId: string, session: ClientSession): Promise<void>;
  moveToTable(
    id: string,
    expectedVersion: number,
    fromTableId: Types.ObjectId,
    toTableId: Types.ObjectId,
    actorId: string,
    session: ClientSession,
  ): Promise<TableSessionDoc | null>;
  listByIds(ids: string[]): Promise<TableSessionDoc[]>;
  claimCollection(
    id: string,
    claim: { owner: string; ownerName: string; tokenHash: string; now: Date; expiresAt: Date },
    session: ClientSession,
  ): Promise<TableSessionDoc | null>;
  lockUnclaimed(id: string, session: ClientSession): Promise<TableSessionDoc | null>;
  releaseClaim(id: string, owner: string, tokenHash: string): Promise<void>;
  clearClaim(id: string, session: ClientSession): Promise<void>;
  lockClaimedBy(
    id: string,
    owner: string,
    tokenHash: string,
    session: ClientSession,
  ): Promise<TableSessionDoc | null>;
  listUnpaidSummaries(): Promise<UnpaidSessionSummary[]>;
  hasActiveClaim(session: ClientSession): Promise<boolean>;
  lockForCorrection(
    id: unknown,
    allowClosed: boolean,
    session: ClientSession,
  ): Promise<TableSessionDoc | null>;
  listOccupiedTableIds(): Promise<Types.ObjectId[]>;
  touchOpen(id: unknown, session: ClientSession): Promise<TableSessionDoc | null>;
  findOpen(id: string): Promise<TableSessionDoc | null>;
  listOpenExcept(id: unknown): Promise<TableSessionDoc[]>;
  findOpenAtTable(
    id: string,
    tableId: string,
    session: ClientSession,
  ): Promise<TableSessionDoc | null>;
  countOpen(ids: unknown[], session: ClientSession): Promise<number>;
  listOpenIds(session?: ClientSession | null): Promise<unknown[]>;
  touchOpenMany(ids: unknown[], session: ClientSession): Promise<void>;
}

export const tableSessionRepository: ITableSessionRepository = {
  async findActiveByTable(tableId, session) {
    return TableSessionModel.findOne({ tableId, status: { $in: ['OPEN', 'CHECKOUT'] } }, null, {
      session: session ?? undefined,
    });
  },
  async findById(id, session) {
    return TableSessionModel.findById(id, null, { session: session ?? undefined });
  },
  async create(data, session) {
    try {
      return await TableSessionModel.create(
        [
          {
            tableId: data.tableId,
            openedBy: data.openedBy ?? null,
            source: data.source ?? 'STAFF',
          },
        ],
        { session: session ?? undefined },
      ).then((d) => d[0]!);
    } catch (e: unknown) {
      const err = e as { code?: number };
      if (err.code === 11000) {
        throw new ConflictError(
          'TABLE_SESSION_ALREADY_OPEN',
          'Bàn này đang có phiên phục vụ, hãy đóng phiên cũ trước.',
        );
      }
      throw e;
    }
  },
  async updateStatus(id, expectedVersion, update, session) {
    const filter = { _id: id, version: expectedVersion };
    const options = { new: true, session: session ?? undefined };

    if (update.status === 'CLOSED') {
      const closed = await TableSessionModel.findOneAndUpdate(
        filter,
        {
          $set: {
            status: update.status,
            closedAt: new Date(),
            closedBy: update.closedBy ?? null,
            closedReason: update.closedReason ?? 'STAFF',
            ...(update.billId !== undefined ? { billId: update.billId } : {}),
          },
          $inc: { version: 1 },
        },
        options,
      );
      if (closed && session) await completeSessionReservation(id, session);
      return closed;
    }

    // Mở lại phiên (OPEN / CHECKOUT) phải sạch mọi dấu vết đã đóng trước đó.
    return TableSessionModel.findOneAndUpdate(
      filter,
      {
        $set: {
          status: update.status,
          closedBy: null,
          ...(update.billId !== undefined ? { billId: update.billId } : {}),
        },
        $unset: { closedAt: 1, closedReason: 1 },
        $inc: { version: 1 },
      },
      options,
    );
  },
  async listOpen() {
    return TableSessionModel.find({ status: { $in: ['OPEN', 'CHECKOUT'] } });
  },
  async listIdleCandidates(cutoff) {
    return TableSessionModel.find({ status: 'OPEN', source: 'GUEST', startedAt: { $lt: cutoff } });
  },
  /** Khóa phiên còn OPEN (tăng version) trong transaction; null nếu phiên đang thanh toán/đã đóng. */
  async lockOpen(id: unknown, session: ClientSession) {
    return TableSessionModel.findOneAndUpdate(
      { _id: id, status: 'OPEN' },
      { $inc: { version: 1 } },
      { session, new: true },
    );
  },
  async listActiveIds() {
    return TableSessionModel.find({ status: { $in: ['OPEN', 'CHECKOUT'] } })
      .select('_id')
      .lean();
  },
  /**
   * Khóa phiên chưa đóng để hoàn tiền, khi không có nhân viên khác đang giữ quyền thu tiền của phiên
   * (hoặc chính người này giữ, hoặc quyền đã hết hạn).
   */
  async lockForRefund(id, actorId, session) {
    return TableSessionModel.findOneAndUpdate(
      {
        _id: id,
        status: { $ne: 'CLOSED' },
        $or: [
          { collectionExpiresAt: null },
          { collectionExpiresAt: { $lte: new Date() } },
          { collectionOwner: actorId },
        ],
      },
      { $inc: { version: 1 } },
      { new: true, session },
    );
  },
  async isOpen(id, session) {
    return !!(await TableSessionModel.exists({ _id: id, status: 'OPEN' }).session(session ?? null));
  },
  async attachBill(id, billId, session) {
    await TableSessionModel.updateOne({ _id: id }, { $set: { billId } }, { session });
  },
  /** Chuyển phiên OPEN sang bàn khác nếu đúng version, ghi lại lịch sử chuyển bàn. */
  async moveToTable(id, expectedVersion, fromTableId, toTableId, actorId, session) {
    return TableSessionModel.findOneAndUpdate(
      { _id: id, status: 'OPEN', version: expectedVersion },
      {
        $set: { tableId: toTableId },
        $inc: { version: 1 },
        $push: { tableTransfers: { fromTableId, toTableId, by: actorId, at: new Date() } },
      },
      { new: true, session },
    );
  },
  async listByIds(ids) {
    return TableSessionModel.find({ _id: { $in: ids } });
  },
  /**
   * Giữ quyền thu tiền của phiên cho một nhân viên khi chưa ai giữ, quyền cũ đã hết hạn, hoặc chính
   * người đó gia hạn bằng đúng token.
   */
  async claimCollection(id, claim, session) {
    return TableSessionModel.findOneAndUpdate(
      {
        _id: id,
        status: { $in: ['OPEN', 'CHECKOUT'] },
        $or: [
          { collectionExpiresAt: null },
          { collectionExpiresAt: { $lte: claim.now } },
          { collectionOwner: claim.owner, collectionTokenHash: claim.tokenHash },
        ],
      },
      {
        $set: {
          collectionOwner: claim.owner,
          collectionOwnerName: claim.ownerName,
          collectionTokenHash: claim.tokenHash,
          collectionExpiresAt: claim.expiresAt,
        },
        $inc: { version: 1 },
      },
      { new: true, session },
    );
  },
  /** Khóa phiên chưa đóng khi không ai đang giữ quyền thu tiền. */
  async lockUnclaimed(id, session) {
    return TableSessionModel.findOneAndUpdate(
      {
        _id: id,
        status: { $ne: 'CLOSED' },
        $or: [{ collectionExpiresAt: null }, { collectionExpiresAt: { $lte: new Date() } }],
      },
      { $inc: { version: 1 } },
      { new: true, session },
    );
  },
  async releaseClaim(id, owner, tokenHash) {
    await TableSessionModel.updateOne(
      { _id: id, collectionOwner: owner, collectionTokenHash: tokenHash },
      {
        $set: {
          collectionOwner: null,
          collectionOwnerName: '',
          collectionTokenHash: '',
          collectionExpiresAt: null,
        },
        $inc: { version: 1 },
      },
    );
  },
  async clearClaim(id, session) {
    await TableSessionModel.updateOne(
      { _id: id },
      {
        $set: {
          collectionOwner: null,
          collectionOwnerName: '',
          collectionTokenHash: '',
          collectionExpiresAt: null,
        },
      },
      { session },
    );
  },
  /** Khóa phiên mà nhân viên này đang giữ quyền thu tiền hợp lệ (đúng token, chưa hết hạn). */
  async lockClaimedBy(id, owner, tokenHash, session) {
    return TableSessionModel.findOneAndUpdate(
      {
        _id: id,
        status: { $in: ['OPEN', 'CHECKOUT'] },
        collectionOwner: owner,
        collectionTokenHash: tokenHash,
        collectionExpiresAt: { $gt: new Date() },
      },
      { $inc: { version: 1 } },
      { new: true, session },
    );
  },
  /** Phiên đang mở/chờ thanh toán kèm bàn và số tiền chưa thu, phiên cũ nhất trước. */
  async listUnpaidSummaries() {
    return TableSessionModel.aggregate<UnpaidSessionSummary>([
      { $match: { status: { $in: ['OPEN', 'CHECKOUT'] } } },
      {
        $lookup: {
          from: 'tables',
          localField: 'tableId',
          foreignField: '_id',
          as: 'table',
        },
      },
      {
        $lookup: {
          from: 'orders',
          let: { sessionId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$tableSessionId', '$$sessionId'] },
                paymentStatus: 'UNPAID',
                status: { $ne: 'CANCELLED' },
              },
            },
          ],
          as: 'unpaidOrders',
        },
      },
      {
        $project: {
          _id: 0,
          id: { $toString: '$_id' },
          tableCode: { $ifNull: [{ $first: '$table.code' }, ''] },
          tableName: { $ifNull: [{ $first: '$table.name' }, 'Bàn'] },
          status: 1,
          startedAt: 1,
          unpaidTotal: {
            $sum: {
              $map: {
                input: '$unpaidOrders',
                as: 'order',
                in: { $subtract: ['$$order.total', { $ifNull: ['$$order.paidAmount', 0] }] },
              },
            },
          },
        },
      },
      { $sort: { startedAt: 1 } },
    ]);
  },
  /** Có nhân viên nào đang giữ quyền thu tiền chưa hết hạn ở phiên còn mở hay không. */
  async hasActiveClaim(session) {
    return !!(await TableSessionModel.exists({
      status: { $in: ['OPEN', 'CHECKOUT'] },
      collectionExpiresAt: { $gt: new Date() },
    }).session(session));
  },
  /** Khóa phiên để điều chỉnh khoản thu khi không ai đang giữ quyền thu tiền. */
  async lockForCorrection(id, allowClosed, session) {
    return TableSessionModel.findOneAndUpdate(
      {
        _id: id,
        ...(allowClosed ? {} : { status: { $in: ['OPEN', 'CHECKOUT'] } }),
        $or: [{ collectionExpiresAt: null }, { collectionExpiresAt: { $lte: new Date() } }],
      },
      { $inc: { version: 1 } },
      { new: true, session },
    );
  },
  async listOccupiedTableIds() {
    return TableSessionModel.distinct('tableId', { status: { $in: ['OPEN', 'CHECKOUT'] } });
  },
  /** Như lockOpen nhưng trả về bản trước khi tăng version (chỉ dùng để biết phiên còn mở). */
  async touchOpen(id, session) {
    return TableSessionModel.findOneAndUpdate(
      { _id: id, status: 'OPEN' },
      { $inc: { version: 1 } },
      { session },
    );
  },
  async findOpen(id) {
    return TableSessionModel.findOne({ _id: id, status: 'OPEN' });
  },
  async listOpenExcept(id) {
    return TableSessionModel.find({ status: 'OPEN', _id: { $ne: id } });
  },
  async findOpenAtTable(id, tableId, session) {
    return TableSessionModel.findOne({ _id: id, tableId, status: 'OPEN' }).session(session);
  },
  async countOpen(ids, session) {
    return TableSessionModel.countDocuments({ _id: { $in: ids }, status: 'OPEN' }).session(session);
  },
  async listOpenIds(session) {
    return TableSessionModel.distinct('_id', { status: 'OPEN' }).session(session ?? null);
  },
  async touchOpenMany(ids, session) {
    await TableSessionModel.updateMany(
      { _id: { $in: ids }, status: 'OPEN' },
      { $inc: { version: 1 } },
      { session },
    );
  },
};
