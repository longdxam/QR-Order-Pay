import type { ClientSession } from 'mongoose';
import { GiftModel } from '../models/Gift.js';

export const giftRepository = {
  async findById(id: string, session: ClientSession) {
    return GiftModel.findById(id).session(session);
  },
  /** Phiên còn lời mời quà (gửi hoặc nhận) đang chờ/đã nhận và chưa hết hạn. */
  async hasLiveInvitation(tableSessionId: string, session: ClientSession): Promise<boolean> {
    return !!(await GiftModel.exists({
      $or: [{ senderSessionId: tableSessionId }, { recipientSessionId: tableSessionId }],
      status: { $in: ['PENDING', 'ACCEPTED'] },
      expiresAt: { $gt: new Date() },
    }).session(session));
  },
  async findByRequest(
    owner: { senderSessionId: string; senderParticipantId: string },
    requestId: string,
  ) {
    return GiftModel.findOne({ ...owner, requestId });
  },
  async countSentSince(
    owner: { senderSessionId: string; senderParticipantId: string },
    since: Date,
    session: ClientSession,
  ): Promise<number> {
    return GiftModel.countDocuments({ ...owner, createdAt: { $gt: since } }).session(session);
  },
  /** Lời mời đang chờ/đã nhận và chưa hết hạn theo bộ lọc (người gửi hoặc bàn nhận). */
  async countLive(scope: Record<string, unknown>, session: ClientSession): Promise<number> {
    return GiftModel.countDocuments({
      ...scope,
      status: { $in: ['PENDING', 'ACCEPTED'] },
      expiresAt: { $gt: new Date() },
    }).session(session);
  },
  async create(data: Record<string, unknown>, session: ClientSession) {
    const [gift] = await GiftModel.create([data], { session });
    return gift;
  },
  /** 30 quà mới nhất mỗi trang. */
  async page(filter: Record<string, unknown>, page: number) {
    return GiftModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * 30)
      .limit(30);
  },
  async count(filter: Record<string, unknown>): Promise<number> {
    return GiftModel.countDocuments(filter);
  },
  async countIncoming(recipientSessionId: string): Promise<number> {
    return GiftModel.countDocuments({
      recipientSessionId,
      status: 'PENDING',
      expiresAt: { $gt: new Date() },
    });
  },
  /** Lời mời còn mở, sắp hết hạn trước (tối đa 200) để quét hết hạn. */
  async listOpenByExpiry() {
    return GiftModel.find({ status: { $in: ['PENDING', 'ACCEPTED'] } })
      .sort({ expiresAt: 1 })
      .limit(200);
  },
  async findOpen(id: unknown, session: ClientSession) {
    return GiftModel.findOne({ _id: id, status: { $in: ['PENDING', 'ACCEPTED'] } }).session(
      session,
    );
  },
};
