import type { ClientSession } from 'mongoose';
import { CupPhotoModel, CupPhotoOwnerModel, CupPrintAttemptModel } from '../models/CupPhoto.js';

const live = () => ({ expiresAt: { $gt: new Date() } });

export const cupPhotoRepository = {
  async findLive(id: unknown, owner: string, session?: ClientSession | null) {
    return CupPhotoModel.findOne({ _id: id, owner, ...live() }).session(session ?? null);
  },
  /** Ảnh còn hạn bất kể chủ sở hữu (nhân viên in ảnh của đơn đã thanh toán), kèm dữ liệu. */
  async findPrintable(id: unknown, session?: ClientSession | null) {
    return CupPhotoModel.findOne({ _id: id, ...live() })
      .select('+data')
      .session(session ?? null);
  },
  async listLive(ids: unknown[]) {
    return CupPhotoModel.find({ _id: { $in: ids }, ...live() });
  },
  /** Gia hạn ảnh còn hạn của chủ sở hữu tới ít nhất `until` (khi gắn vào đơn). */
  async extendLive(id: unknown, owner: string, until: Date, session?: ClientSession) {
    return CupPhotoModel.findOneAndUpdate(
      { _id: id, owner, ...live() },
      { $max: { expiresAt: until } },
      { session },
    );
  },
  async findByRequest(owner: string, requestId: string, session: ClientSession) {
    return CupPhotoModel.findOne({ owner, requestId }).session(session);
  },
  /** Số ảnh tự tải lên (không tính latte art) từ `since`. */
  async countUploadsSince(owner: string, since: Date, session: ClientSession): Promise<number> {
    return CupPhotoModel.countDocuments({
      owner,
      kind: { $ne: 'LATTE_ART' },
      createdAt: { $gt: since },
    }).session(session);
  },
  async createOne(data: Record<string, unknown>, session: ClientSession) {
    const [photo] = await CupPhotoModel.create([data], { session });
    return photo;
  },
  /** Ảnh còn hạn của chủ sở hữu, kèm dữ liệu ảnh. */
  async findLiveWithData(id: unknown, owner: string) {
    return CupPhotoModel.findOne({ _id: id, owner, ...live() }).select('+data');
  },
  async existsLive(id: string, owner: string, session: ClientSession): Promise<boolean> {
    return !!(await CupPhotoModel.exists({ _id: id, owner, ...live() }).session(session));
  },
  async listLatteArt(
    owner: string,
    sourcePhotoId: string,
    requestIds: string[],
    session?: ClientSession | null,
  ) {
    return CupPhotoModel.find({
      owner,
      sourcePhotoId,
      kind: 'LATTE_ART',
      requestId: { $in: requestIds },
      ...live(),
    }).session(session ?? null);
  },
  async create(data: Record<string, unknown>, session: ClientSession): Promise<void> {
    await CupPhotoModel.create([data], { session });
  },
};

export const cupPhotoOwnerRepository = {
  /** Khóa (tạo nếu chưa có) bản ghi chủ sở hữu để giới hạn tải ảnh được kiểm tra tuần tự. */
  async lock(owner: string, expiresAt: Date, session: ClientSession): Promise<void> {
    await CupPhotoOwnerModel.findOneAndUpdate(
      { _id: owner },
      { $inc: { version: 1 }, $set: { expiresAt } },
      { upsert: true, session },
    );
  },
};

export const cupPrintAttemptRepository = {
  async listForOrder(orderId: unknown) {
    return CupPrintAttemptModel.find({ orderId });
  },
  async findByRequest(userId: string, requestId: string) {
    return CupPrintAttemptModel.findOne({ userId, requestId });
  },
  async create(data: Record<string, unknown>, session: ClientSession) {
    const [attempt] = await CupPrintAttemptModel.create([data], { session });
    return attempt;
  },
};
