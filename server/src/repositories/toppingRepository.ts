import type { ClientSession } from 'mongoose';
import { ToppingModel, type ToppingDoc } from '../models/Topping.js';

export const toppingRepository = {
  async listAvailable(): Promise<ToppingDoc[]> {
    return ToppingModel.find({ isArchived: false, isAvailable: true }).sort({ name: 1 });
  },
  async listAll(): Promise<ToppingDoc[]> {
    return ToppingModel.find().sort({ name: 1 });
  },
  async findManyByIds(ids: string[], session?: ClientSession | null): Promise<ToppingDoc[]> {
    return ToppingModel.find({ _id: { $in: ids } }, null, { session: session ?? undefined });
  },
  async findById(id: string, session?: ClientSession | null): Promise<ToppingDoc | null> {
    return ToppingModel.findById(id, null, { session: session ?? undefined });
  },
  async create(data: { name: string; price: number; isAvailable?: boolean }) {
    return ToppingModel.create(data);
  },
  async update(id: string, update: Partial<{ name: string; price: number; isAvailable: boolean; isArchived: boolean }>) {
    return ToppingModel.findByIdAndUpdate(id, update, { new: true });
  },
};
