import type { ClientSession } from 'mongoose';
import { VoucherModel, VoucherUseModel, type VoucherDoc } from '../models/Voucher.js';

export const voucherRepository = {
  async listRecent(limit = 200) {
    return VoucherModel.find().sort({ createdAt: -1 }).limit(limit);
  },
  async findById(id: string, session: ClientSession) {
    return VoucherModel.findById(id).session(session);
  },
  async findByCode(code: string, session?: ClientSession | null) {
    return VoucherModel.findOne({ code }).session(session ?? null);
  },
  async update(
    id: string,
    expectedVersion: unknown,
    fields: Record<string, unknown>,
    session: ClientSession,
  ) {
    return VoucherModel.findOneAndUpdate(
      { _id: id, version: expectedVersion },
      { $set: fields, $inc: { version: 1 } },
      { new: true, session },
    );
  },
  async create(
    fields: Record<string, unknown>,
    session: ClientSession,
  ): Promise<VoucherDoc | undefined> {
    const [created] = await VoucherModel.create([fields], { session });
    return created;
  },
  /** Dùng một lượt nếu voucher còn hiệu lực, đúng version đã báo giá và chưa hết lượt. */
  async claimUse(id: unknown, version: number, session: ClientSession) {
    return VoucherModel.findOneAndUpdate(
      { _id: id, version, isActive: true, $expr: { $lt: ['$usedCount', '$maxUses'] } },
      { $inc: { usedCount: 1 } },
      { new: true, session },
    );
  },
  /** Xóa hẳn chỉ khi chưa có lượt nào đang giữ/đã dùng (kiểm tra lại ngay lúc xóa). */
  async deleteUnused(id: string, session: ClientSession) {
    return VoucherModel.findOneAndDelete({ _id: id, usedCount: 0 }, { session });
  },
  async returnUse(id: unknown, session: ClientSession): Promise<void> {
    await VoucherModel.updateOne({ _id: id }, { $inc: { usedCount: -1 } }, { session });
  },
};

export const voucherUseRepository = {
  /** Voucher đã từng gắn với đơn nào chưa (kể cả lượt đã trả lại khi hủy đơn). */
  async existsForVoucher(voucherId: string, session: ClientSession): Promise<boolean> {
    return !!(await VoucherUseModel.exists({ voucherId }).session(session));
  },
  /** Số lượt thành viên đã dùng voucher (không tính lượt đã trả lại). */
  async countByMember(voucherId: unknown, memberId: unknown, session?: ClientSession | null) {
    return VoucherUseModel.countDocuments({
      voucherId,
      memberId,
      state: { $ne: 'RELEASED' },
    }).session(session ?? null);
  },
  async create(
    data: { voucherId: unknown; memberId: unknown; orderId: unknown },
    session: ClientSession,
  ): Promise<void> {
    await VoucherUseModel.create([data], { session });
  },
  async consumeForOrder(orderId: unknown, session: ClientSession): Promise<void> {
    await VoucherUseModel.updateOne(
      { orderId, state: 'RESERVED' },
      { $set: { state: 'CONSUMED' } },
      { session },
    );
  },
  async releaseForOrder(orderId: unknown, session: ClientSession) {
    return VoucherUseModel.findOneAndUpdate(
      { orderId, state: 'RESERVED' },
      { $set: { state: 'RELEASED' } },
      { new: true, session },
    );
  },
};
