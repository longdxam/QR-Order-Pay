import type { ClientSession } from 'mongoose';
import { GuestSessionModel, type GuestSessionDoc } from '../models/GuestSession.js';

export interface IGuestSessionRepository {
  findActiveByTokenHash(hash: string): Promise<{
    id: string;
    tableSessionId: string;
    participantId: string;
    expiresAt: Date;
  } | null>;
  create(
    data: {
      tableSessionId: string;
      participantId: string;
      tokenHash: string;
      receiptTokenHash?: string;
      expiresAt: Date;
    },
    session?: ClientSession,
  ): Promise<{ id: string; tokenHash: string }>;
  touch(id: string): Promise<void>;
  revokeByTableSession(tableSessionId: string, session?: ClientSession): Promise<number>;
  revokeByHash(hash: string): Promise<boolean>;
  clearReceiptByHash(hash: string): Promise<boolean>;
  findByReceiptHash(hash: string): Promise<GuestSessionDoc | null>;
  listSessionsWithLiveGuests(tableSessionIds: unknown[]): Promise<unknown[]>;
  hasLiveGuest(tableSessionId: string, session: ClientSession): Promise<boolean>;
}

export const guestSessionRepository: IGuestSessionRepository = {
  async findActiveByTokenHash(hash) {
    const doc = await GuestSessionModel.findOne({
      tokenHash: hash,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    });
    if (!doc) return null;
    return {
      id: doc._id.toString(),
      tableSessionId: doc.tableSessionId.toString(),
      participantId: doc.participantId,
      expiresAt: doc.expiresAt,
    };
  },
  async create(data, session) {
    const [doc] = await GuestSessionModel.create([data], { session });
    if (!doc) throw new Error('Failed to create guest session');
    return { id: doc._id.toString(), tokenHash: doc.tokenHash };
  },
  async touch(id) {
    await GuestSessionModel.updateOne({ _id: id }, { $set: { lastSeenAt: new Date() } });
  },
  async revokeByTableSession(tableSessionId, session) {
    const r = await GuestSessionModel.updateMany(
      { tableSessionId, revokedAt: null },
      { $set: { revokedAt: new Date() } },
      { session },
    );
    return r.modifiedCount ?? 0;
  },
  async revokeByHash(hash) {
    const r = await GuestSessionModel.updateOne(
      { tokenHash: hash, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
    return r.modifiedCount > 0;
  },
  async clearReceiptByHash(hash) {
    const result = await GuestSessionModel.updateOne(
      { receiptTokenHash: hash },
      { $unset: { receiptTokenHash: 1 } },
    );
    return result.modifiedCount > 0;
  },
  /** Phiên khách còn hạn giữ quyền xem biên nhận (kể cả đã bị thu hồi quyền gọi món). */
  async findByReceiptHash(hash: string) {
    return GuestSessionModel.findOne({ receiptTokenHash: hash, expiresAt: { $gt: new Date() } });
  },
  /** Phiên (trong danh sách) còn ít nhất một khách đang dùng: chưa thu hồi, chưa hết hạn. */
  async listSessionsWithLiveGuests(tableSessionIds) {
    return GuestSessionModel.distinct('tableSessionId', {
      tableSessionId: { $in: tableSessionIds },
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    });
  },
  async hasLiveGuest(tableSessionId, session) {
    return !!(await GuestSessionModel.exists({
      tableSessionId,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    }).session(session));
  },
};
