import type { ClientSession } from 'mongoose';
import { TableModel, type TableDoc } from '../models/Table.js';

export interface ITableRepository {
  list(): Promise<TableDoc[]>;
  findById(id: string, session?: ClientSession | null): Promise<TableDoc | null>;
  findByCode(code: string): Promise<TableDoc | null>;
  findByPublicTokenHash(hash: string): Promise<TableDoc | null>;
  create(data: { code: string; name: string; capacity: number; publicTokenHash: string }): Promise<TableDoc>;
  update(id: string, update: Partial<{ name: string; capacity: number; isActive: boolean; publicTokenHash: string }>): Promise<TableDoc | null>;
}

export const tableRepository: ITableRepository = {
  async list() {
    return TableModel.find().sort({ code: 1 });
  },
  async findById(id, session) {
    return TableModel.findById(id, null, { session: session ?? undefined });
  },
  async findByCode(code) {
    return TableModel.findOne({ code });
  },
  async findByPublicTokenHash(hash) {
    return TableModel.findOne({ publicTokenHash: hash });
  },
  async create(data) {
    return TableModel.create(data);
  },
  async update(id, update) {
    return TableModel.findByIdAndUpdate(id, update, { new: true });
  },
};
