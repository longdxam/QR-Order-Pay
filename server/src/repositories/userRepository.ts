import type { ClientSession, FilterQuery, Types, UpdateQuery } from 'mongoose';
import { UserModel, type UserDoc } from '../models/User.js';
import type { Role } from '@may-cafe/contracts';

export interface IUserRepository {
  findByEmail(email: string): Promise<UserDoc | null>;
  findById(id: string, session?: ClientSession | null): Promise<UserDoc | null>;
  create(data: { name: string; email: string; passwordHash: string; role: Role }): Promise<UserDoc>;
  update(
    id: string,
    update: UpdateQuery<UserDoc>,
    session?: ClientSession | null,
  ): Promise<UserDoc | null>;
  list(filter?: FilterQuery<UserDoc>): Promise<UserDoc[]>;
  /**
   * Khóa tài khoản còn hoạt động trong transaction (tăng `__v`) để thao tác đồng thời trên cùng
   * nhân viên phải xếp hàng; `role` giới hạn thêm theo vai trò.
   */
  lockActive(id: string, session: ClientSession, role?: Role): Promise<UserDoc | null>;
  /** Khóa tài khoản kể cả khi đã ngừng/xóa (vd. hủy lịch tương lai của người đã nghỉ). */
  lockAny(id: unknown, session: ClientSession): Promise<void>;
  isActiveAdmin(id: string): Promise<boolean>;
  listByIds(ids: unknown[], session?: ClientSession | null): Promise<UserDoc[]>;
  /** Danh sách nhân sự chưa xóa cho lịch ca: chỉ tên và trạng thái, sắp theo tên. */
  listRoster(): Promise<Array<{ _id: Types.ObjectId; name: string; isActive: boolean }>>;
  lockAdmin(id: string, session: ClientSession): Promise<UserDoc | null>;
  emailTaken(email: string, session: ClientSession): Promise<boolean>;
  replacePassword(
    id: string,
    currentHash: string,
    passwordHash: string,
    session: ClientSession,
  ): Promise<UserDoc | null>;
}

export const userRepository: IUserRepository = {
  async findByEmail(email) {
    return UserModel.findOne({ email: email.toLowerCase() });
  },
  async findById(id, session) {
    return UserModel.findById(id, null, { session: session ?? undefined });
  },
  async create(data) {
    return UserModel.create(data);
  },
  async update(id, update, session) {
    return UserModel.findByIdAndUpdate(id, update, { new: true, session: session ?? undefined });
  },
  async list(filter = {}) {
    return UserModel.find(filter).sort({ createdAt: -1 });
  },
  async lockActive(id, session, role) {
    return UserModel.findOneAndUpdate(
      { _id: id, isActive: true, isDeleted: { $ne: true }, ...(role ? { role } : {}) },
      { $inc: { __v: 1 } },
      { new: true, session },
    );
  },
  async lockAny(id, session) {
    await UserModel.updateOne({ _id: id }, { $inc: { __v: 1 } }, { session });
  },
  async isActiveAdmin(id) {
    return !!(await UserModel.exists({
      _id: id,
      role: 'ADMIN',
      isActive: true,
      isDeleted: { $ne: true },
    }));
  },
  async listByIds(ids, session) {
    return UserModel.find({ _id: { $in: ids } }).session(session ?? null);
  },
  async listRoster() {
    return UserModel.find({ isDeleted: { $ne: true } })
      .select('name isActive')
      .sort({ name: 1 })
      .lean();
  },
  /**
   * Khóa Admin còn hoạt động (kể cả tài khoản đã đánh dấu xóa, như trước khi tách repository):
   * hai Admin không thể đồng thời hạ quyền/xóa lẫn nhau.
   */
  async lockAdmin(id: string, session: ClientSession) {
    return UserModel.findOneAndUpdate(
      { _id: id, role: 'ADMIN', isActive: true },
      { $inc: { __v: 1 } },
      { new: true, session },
    );
  },
  async emailTaken(email: string, session: ClientSession): Promise<boolean> {
    return !!(await UserModel.exists({ email }).session(session));
  },
  /** Đổi mật khẩu chỉ khi hash cũ chưa đổi; tăng authVersion để vô hiệu access token cũ. */
  async replacePassword(
    id: string,
    currentHash: string,
    passwordHash: string,
    session: ClientSession,
  ) {
    return UserModel.findOneAndUpdate(
      { _id: id, passwordHash: currentHash, isActive: true },
      { $set: { passwordHash }, $inc: { authVersion: 1 } },
      { session },
    );
  },
};
