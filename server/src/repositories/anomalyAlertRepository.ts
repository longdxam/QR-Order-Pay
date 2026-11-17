import type { UpdateQuery } from 'mongoose';
import { AnomalyAlertModel, type AnomalyAlertDoc } from '../models/AnomalyAlert.js';

export const anomalyAlertRepository = {
  async listRecent(limit = 50) {
    return AnomalyAlertModel.find().sort({ lastDetectedAt: -1 }).limit(limit).lean();
  },
  /** Đổi trạng thái chỉ khi cảnh báo đang ở một trong `allowedStatuses`. */
  async transition(id: string, allowedStatuses: string[], update: UpdateQuery<AnomalyAlertDoc>) {
    return AnomalyAlertModel.findOneAndUpdate(
      { _id: id, status: { $in: allowedStatuses } },
      update,
      { new: true },
    ).lean();
  },
  /** Cảnh báo còn mở/đã xác nhận gần nhất cùng detector và đích, trong thời gian cooldown. */
  async findOpenSince(detector: string, target: string, since: Date) {
    return AnomalyAlertModel.findOne({
      detector,
      target,
      status: { $in: ['OPEN', 'ACKNOWLEDGED'] },
      lastDetectedAt: { $gte: since },
    }).sort({ lastDetectedAt: -1 });
  },
  async create(data: Record<string, unknown>): Promise<void> {
    await AnomalyAlertModel.create(data);
  },
};
