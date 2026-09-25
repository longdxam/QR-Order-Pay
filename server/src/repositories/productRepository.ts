import type { ClientSession } from 'mongoose';
import { ProductModel, type ProductDoc } from '../models/Product.js';

export interface PublicProductFilters {
  categoryId?: string;
  q?: string;
  tag?: string;
  includeUnavailable?: boolean;
}

export const productRepository = {
  async listPublic(filters: PublicProductFilters = {}): Promise<ProductDoc[]> {
    const query: Record<string, unknown> = { isArchived: false };
    if (!filters.includeUnavailable) query.isAvailable = true;
    if (filters.categoryId) query.categoryId = filters.categoryId;
    if (filters.tag) query.tags = filters.tag;
    if (filters.q) {
      const regex = new RegExp(escapeRegex(filters.q), 'i');
      query.$or = [{ name: regex }, { description: regex }];
    }
    return ProductModel.find(query).sort({ sortOrder: 1, name: 1 });
  },
  async listFeatured(limit = 6): Promise<ProductDoc[]> {
    return ProductModel.find({ isArchived: false, isAvailable: true, isFeatured: true })
      .sort({ sortOrder: 1 })
      .limit(limit);
  },
  async findById(id: string, session?: ClientSession | null): Promise<ProductDoc | null> {
    return ProductModel.findById(id, null, { session: session ?? undefined });
  },
  async findManyByIds(ids: string[], session?: ClientSession | null): Promise<ProductDoc[]> {
    return ProductModel.find({ _id: { $in: ids } }, null, { session: session ?? undefined });
  },
  async listAll(): Promise<ProductDoc[]> {
    return ProductModel.find().sort({ sortOrder: 1, name: 1 });
  },
  async create(data: Record<string, unknown>, session?: ClientSession | null): Promise<ProductDoc> {
    const [created] = await ProductModel.create([data], { session: session ?? undefined });
    if (!created) throw new Error('Failed to create product');
    return created;
  },
  async update(
    id: string,
    update: Record<string, unknown>,
    session?: ClientSession | null,
  ): Promise<ProductDoc | null> {
    return ProductModel.findByIdAndUpdate(
      id,
      { $set: update, $inc: { version: 1 } },
      { new: true, session: session ?? undefined },
    );
  },
  async archive(id: string, session?: ClientSession | null): Promise<ProductDoc | null> {
    return ProductModel.findByIdAndUpdate(
      id,
      { $set: { isArchived: true }, $inc: { version: 1 } },
      { new: true, session: session ?? undefined },
    );
  },
  async setVariantAvailability(
    id: string,
    variantId: string,
    isAvailable: boolean,
    session?: ClientSession | null,
  ): Promise<ProductDoc | null> {
    return ProductModel.findOneAndUpdate(
      { _id: id, 'variants._id': variantId },
      { $set: { 'variants.$.isAvailable': isAvailable }, $inc: { version: 1 } },
      { new: true, session: session ?? undefined },
    );
  },
};

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
