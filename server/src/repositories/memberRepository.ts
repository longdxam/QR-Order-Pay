import type { ClientSession } from 'mongoose';
import {
  MemberModel,
  MemberSessionModel,
  PointEntryModel,
  type MemberDoc,
} from '../models/Member.js';

const PAGE = 20;

export const memberRepository = {
  async create(
    data: { name: string; phone: string; passwordHash: string },
    session: ClientSession,
  ): Promise<MemberDoc | undefined> {
    const [member] = await MemberModel.create([data], { session });
    return member;
  },
  async findById(id: unknown, session: ClientSession) {
    return MemberModel.findById(id).session(session);
  },
  async findByPhone(phone: string) {
    return MemberModel.findOne({ phone });
  },
  async existsById(id: string, session: ClientSession): Promise<boolean> {
    return !!(await MemberModel.exists({ _id: id }).session(session));
  },
  /** Thành viên còn hoạt động với đúng authVersion của phiên đăng nhập. */
  async findActiveForLogin(id: unknown, authVersion: number, session?: ClientSession | null) {
    return MemberModel.findOne({ _id: id, isActive: true, authVersion }).session(session ?? null);
  },
  /** Khóa thành viên còn hoạt động để các giới hạn theo thành viên được kiểm tra tuần tự. */
  async lockActive(id: string, session: ClientSession) {
    return MemberModel.findOneAndUpdate(
      { _id: id, isActive: true },
      { $inc: { version: 1 } },
      { session, new: true },
    );
  },
  async findActive(id: unknown, session?: ClientSession | null) {
    return MemberModel.findOne({ _id: id, isActive: true }).session(session ?? null);
  },
  async recordFailedLogin(
    id: unknown,
    attempts: number,
    lockedUntil: Date | null,
    session: ClientSession,
  ): Promise<void> {
    await MemberModel.updateOne(
      { _id: id },
      { $set: { failedLogins: attempts, lockedUntil } },
      { session },
    );
  },
  /** Đổi mật khẩu nếu authVersion chưa đổi; tăng authVersion để đăng xuất mọi thiết bị. */
  async replacePassword(
    id: unknown,
    authVersion: number,
    passwordHash: string,
    session: ClientSession,
  ) {
    return MemberModel.findOneAndUpdate(
      { _id: id, authVersion },
      {
        $set: { passwordHash, failedLogins: 0, lockedUntil: null },
        $inc: { authVersion: 1, version: 1 },
      },
      { session },
    );
  },
  async page(filter: Record<string, unknown>, page: number) {
    return Promise.all([
      MemberModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * PAGE)
        .limit(PAGE),
      MemberModel.countDocuments(filter),
    ]);
  },
  /** Admin sửa thành viên theo version; mọi thay đổi đều tăng authVersion. */
  async adminUpdate(
    id: string,
    expectedVersion: number,
    set: Record<string, unknown>,
    session: ClientSession,
  ) {
    return MemberModel.findOneAndUpdate(
      { _id: id, version: expectedVersion },
      { $set: set, $inc: { version: 1, authVersion: 1 } },
      { new: true, session },
    );
  },
  /** Trừ điểm nếu đủ số dư. */
  async spendPoints(id: unknown, points: number, session: ClientSession) {
    return MemberModel.findOneAndUpdate(
      { _id: id, isActive: true, points: { $gte: points } },
      { $inc: { points: -points, version: 1 } },
      { new: true, session },
    );
  },
  async addPoints(id: unknown, points: number, session: ClientSession) {
    return MemberModel.findByIdAndUpdate(
      id,
      { $inc: { points, version: 1 } },
      { new: true, session },
    );
  },
};

export const memberSessionRepository = {
  async findLive(tokenHash: string, session?: ClientSession | null) {
    return MemberSessionModel.findOne({ tokenHash, expiresAt: { $gt: new Date() } }).session(
      session ?? null,
    );
  },
  async create(
    data: { memberId: unknown; tokenHash: string; authVersion: number; expiresAt: Date },
    session: ClientSession,
  ): Promise<void> {
    await MemberSessionModel.create([data], { session });
  },
  async deleteByTokenHash(tokenHash: string): Promise<void> {
    await MemberSessionModel.deleteOne({ tokenHash });
  },
  async deleteAllForMember(memberId: unknown, session: ClientSession): Promise<void> {
    await MemberSessionModel.deleteMany({ memberId }, { session });
  },
};

export const pointEntryRepository = {
  async pageForMember(memberId: string, page: number) {
    return Promise.all([
      PointEntryModel.find({ memberId })
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * PAGE)
        .limit(PAGE),
      PointEntryModel.countDocuments({ memberId }),
    ]);
  },
  async exists(orderId: unknown, type: 'EARN' | 'RETURN', session: ClientSession) {
    return !!(await PointEntryModel.exists({ orderId, type }).session(session));
  },
  async create(data: Record<string, unknown>, session: ClientSession): Promise<void> {
    await PointEntryModel.create([data], { session });
  },
};
