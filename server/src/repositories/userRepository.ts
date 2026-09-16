import type { ClientSession, FilterQuery, UpdateQuery } from 'mongoose';
import { UserModel, type UserDoc } from '../models/User.js';
import type { Role } from '@may-cafe/contracts';

export interface IUserRepository {
  findByEmail(email: string): Promise<UserDoc | null>;
  findById(id: string, session?: ClientSession | null): Promise<UserDoc | null>;
  create(data: { name: string; email: string; passwordHash: string; role: Role }): Promise<UserDoc>;
  update(id: string, update: UpdateQuery<UserDoc>, session?: ClientSession | null): Promise<UserDoc | null>;
  list(filter?: FilterQuery<UserDoc>): Promise<UserDoc[]>;
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
};
