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
};
