import type { ClientSession, Types } from 'mongoose';
import { PaymentCorrectionModel } from '../models/PaymentCorrection.js';

export const paymentCorrectionRepository = {
  /** Còn yêu cầu điều chỉnh chờ duyệt cho một trong các khoản thu, hoặc nhắm tới đơn này. */
  async hasPendingFor(
    paymentIds: Types.ObjectId[],
    targetOrderId: unknown,
    session: ClientSession,
  ): Promise<boolean> {
    return !!(await PaymentCorrectionModel.exists({
      status: 'REQUESTED',
      $or: [{ paymentId: { $in: paymentIds } }, { targetOrderId }],
    }).session(session));
  },
  async create(data: Record<string, unknown>, session: ClientSession) {
    const [correction] = await PaymentCorrectionModel.create([data], { session });
    return correction;
  },
  async findById(id: unknown, session: ClientSession) {
    return PaymentCorrectionModel.findById(id).session(session);
  },
  /** Tối đa 200 yêu cầu, chờ duyệt trước rồi mới nhất. */
  async listRecent(scope: Record<string, unknown>) {
    return PaymentCorrectionModel.find(scope).sort({ status: -1, createdAt: -1 }).limit(200).lean();
  },
};
