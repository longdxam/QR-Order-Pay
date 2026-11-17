import type { ClientSession, Types } from 'mongoose';
import { CancelRequestModel } from '../models/CancelRequest.js';

type Id = string | Types.ObjectId;

export const cancelRequestRepository = {
  /** Có yêu cầu hủy đang chờ duyệt cho đơn hoặc cho bất kỳ đơn nào trong phiên hay không. */
  async hasPending(
    scope: { orderId: Id } | { tableSessionId: Id },
    session?: ClientSession | null,
  ): Promise<boolean> {
    const found = await CancelRequestModel.exists({ ...scope, status: 'REQUESTED' }).session(
      session ?? null,
    );
    return found !== null;
  },
  async listPendingForOrder(orderId: Id, session: ClientSession) {
    return CancelRequestModel.find({ orderId, status: 'REQUESTED' }).session(session);
  },
  async findPendingForOrder(orderId: Id, session: ClientSession) {
    return CancelRequestModel.findOne({ orderId, status: 'REQUESTED' }).session(session);
  },
  async findPendingByParticipant(orderId: Id, participantId: string) {
    return CancelRequestModel.findOne({ orderId, participantId, status: 'REQUESTED' });
  },
  async create(data: Record<string, unknown>, session: ClientSession) {
    const [created] = await CancelRequestModel.create([data], { session });
    return created!;
  },
  /** Yêu cầu chờ duyệt, cũ nhất trước, kèm thông tin đơn cần để nhân viên quyết định. */
  async listPendingWithOrders() {
    return CancelRequestModel.find({ status: 'REQUESTED' })
      .sort({ createdAt: 1 })
      .populate({
        path: 'orderId',
        select: 'code tableId status items total paidAmount version paymentStatus createdAt',
        populate: { path: 'tableId', select: 'name' },
      });
  },
  async findById(id: string, session: ClientSession) {
    return CancelRequestModel.findById(id).session(session);
  },
  /** Chốt quyết định khi yêu cầu còn chờ và đúng version mà người duyệt đã xem. */
  async decide(
    id: string,
    expectedVersion: number,
    decision: { status: 'APPROVED' | 'REJECTED'; decidedBy: string; decisionNote: string },
    session: ClientSession,
  ) {
    return CancelRequestModel.findOneAndUpdate(
      { _id: id, status: 'REQUESTED', version: expectedVersion },
      {
        $set: {
          status: decision.status,
          decidedBy: decision.decidedBy,
          decidedAt: new Date(),
          decisionNote: decision.decisionNote,
        },
        $inc: { version: 1 },
      },
      { new: true, session },
    );
  },
};
