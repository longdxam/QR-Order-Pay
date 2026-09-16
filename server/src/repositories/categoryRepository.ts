import type { ClientSession } from 'mongoose';
import { CategoryModel, type CategoryDoc } from '../models/Category.js';

export const categoryRepository = {
  async listActive(): Promise<CategoryDoc[]> {
    return CategoryModel.find({ isActive: true }).sort({ sortOrder: 1, name: 1 });
  },
  async listAll(): Promise<CategoryDoc[]> {
    return CategoryModel.find().sort({ sortOrder: 1, name: 1 });
  },
  async findById(id: string, session?: ClientSession | null): Promise<CategoryDoc | null> {
    return CategoryModel.findById(id, null, { session: session ?? undefined });
  },
  async create(data: { name: string; slug: string; sortOrder?: number }): Promise<CategoryDoc> {
    return CategoryModel.create(data);
  },
  async update(id: string, update: Partial<{ name: string; sortOrder: number; isActive: boolean }>) {
    return CategoryModel.findByIdAndUpdate(id, update, { new: true });
  },
  async delete(id: string) {
    return CategoryModel.findByIdAndDelete(id);
  },
};
