import { unitOfWork } from '../infrastructure/unitOfWork.js';
import { auditRepository } from '../repositories/auditRepository.js';
import { categoryRepository } from '../repositories/categoryRepository.js';
import { outboxRepository } from '../repositories/outboxRepository.js';
import { productRepository } from '../repositories/productRepository.js';
import { toppingRepository } from '../repositories/toppingRepository.js';
import type { ClientSession } from 'mongoose';
import { NotFoundError } from '../errors/AppError.js';

type CatalogKind = 'Product' | 'Category' | 'Topping';

async function mutation<T>(
  actorId: string,
  kind: CatalogKind,
  action: string,
  work: (session: ClientSession) => Promise<T>,
): Promise<T> {
  return unitOfWork.withTransaction(async (session) => {
    const result = await work(session);
    if (result === null || result === undefined)
      throw new NotFoundError('Không tìm thấy dữ liệu catalog.');
    const id = entityId(result);
    const version =
      'version' in (result as object) &&
      typeof (result as { version?: unknown }).version === 'number'
        ? (result as unknown as { version: number }).version
        : 0;
    await auditRepository.log(
      { actorType: 'USER', actorId, action, entityType: kind, entityId: id },
      session,
    );
    await outboxRepository.createRealtimeEvents(
      [
        {
          eventType: 'menu.availabilityChanged',
          aggregateType: kind,
          aggregateId: id,
          aggregateVersion: version,
          target: { scope: 'all' },
          payload: { entityType: kind, entityId: id, action, version },
        },
      ],
      session,
    );
    return result;
  });
}

export function createProduct(data: Record<string, unknown>, actorId: string) {
  return mutation(actorId, 'Product', 'product.created', (session) =>
    productRepository.create(data, session),
  );
}

export function updateProduct(id: string, data: Record<string, unknown>, actorId: string) {
  return mutation(actorId, 'Product', 'product.updated', (session) =>
    productRepository.update(id, data, session),
  );
}

export function archiveProduct(id: string, actorId: string) {
  return mutation(actorId, 'Product', 'product.archived', (session) =>
    productRepository.archive(id, session),
  );
}

export function createCategory(
  data: { name: string; slug: string; sortOrder?: number },
  actorId: string,
) {
  return mutation(actorId, 'Category', 'category.created', (session) =>
    categoryRepository.create(data, session),
  );
}

export function updateCategory(
  id: string,
  data: Partial<{ name: string; sortOrder: number; isActive: boolean }>,
  actorId: string,
) {
  return mutation(actorId, 'Category', 'category.updated', (session) =>
    categoryRepository.update(id, data, session),
  );
}

export function createTopping(
  data: { name: string; price: number; isAvailable?: boolean },
  actorId: string,
) {
  return mutation(actorId, 'Topping', 'topping.created', (session) =>
    toppingRepository.create(data, session),
  );
}

export function updateTopping(
  id: string,
  data: Partial<{ name: string; price: number; isAvailable: boolean; isArchived: boolean }>,
  actorId: string,
) {
  return mutation(actorId, 'Topping', 'topping.updated', (session) =>
    toppingRepository.update(id, data, session),
  );
}

export function setProductAvailability(id: string, isAvailable: boolean, actorId: string) {
  return mutation(actorId, 'Product', 'product.availabilityChanged', (session) =>
    productRepository.update(id, { isAvailable }, session),
  );
}

export function setVariantAvailability(
  productId: string,
  variantId: string,
  isAvailable: boolean,
  actorId: string,
) {
  return mutation(actorId, 'Product', 'productVariant.availabilityChanged', (session) =>
    productRepository.setVariantAvailability(productId, variantId, isAvailable, session),
  );
}

export function setToppingAvailability(id: string, isAvailable: boolean, actorId: string) {
  return mutation(actorId, 'Topping', 'topping.availabilityChanged', (session) =>
    toppingRepository.update(id, { isAvailable }, session),
  );
}

function entityId(value: unknown): string {
  if (!value || typeof value !== 'object' || !('_id' in value)) return 'unknown';
  return String((value as { _id: unknown })._id);
}
