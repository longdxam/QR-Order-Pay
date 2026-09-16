import type { ClientSession } from 'mongoose';
import { GuestSessionModel } from '../models/GuestSession.js';

export interface IGuestSessionRepository {
  findActiveByTokenHash(hash: string): Promise<{
    id: string;
    tableSessionId: string;
    participantId: string;
    expiresAt: Date;
  } | null>;
  create(data: {
    tableSessionId: string;
    participantId: string;
    tokenHash: string;
    receiptTokenHash?: string;
    expiresAt: Date;
  }): Promise<{ id: string; tokenHash: string }>;
  touch(id: string): Promise<void>;
  revokeByTableSession(tableSessionId: string, session?: ClientSession): Promise<number>;
  revokeByHash(hash: string): Promise<boolean>;
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
  async create(data) {
    const doc = await GuestSessionModel.create(data);
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
    const r = await GuestSessionModel.updateOne({ tokenHash: hash, revokedAt: null }, { $set: { revokedAt: new Date() } });
    return r.modifiedCount > 0;
  },
};
