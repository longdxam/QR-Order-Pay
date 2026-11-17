import type { ClientSession } from 'mongoose';
import type { OrderDoc } from '../models/Order.js';
import { stockRepository } from '../repositories/inventoryRepository.js';
import { orderRepository } from '../repositories/orderRepository.js';
import { ConflictError } from '../errors/AppError.js';
import { assertInventoryAvailable, type InventoryItem } from './inventoryAvailabilityService.js';
import { inventoryChanged, lockInventoryTarget } from './inventoryService.js';

export async function reserveOrderInventory(
  items: InventoryItem[],
  orderId: string,
  session: ClientSession,
) {
  const targets = new Map<string, { type: 'PRODUCT' | 'TOPPING'; id: string }>();
  for (const item of items) {
    if (!item.freestyle)
      targets.set(`PRODUCT:${item.productId}`, { type: 'PRODUCT', id: String(item.productId) });
    for (const id of item.toppingIds)
      targets.set(`TOPPING:${id}`, { type: 'TOPPING', id: String(id) });
  }
  for (const [, target] of [...targets].sort(([a], [b]) => a.localeCompare(b)))
    await lockInventoryTarget(target.type, target.id, session);
  const requirements = await assertInventoryAvailable(items, session);
  for (const line of requirements) {
    const ingredient = await stockRepository.reserve(line.ingredientId, line.quantity, session);
    if (!ingredient)
      throw new ConflictError(
        'INSUFFICIENT_STOCK',
        'Nguyên liệu vừa hết. Vui lòng cập nhật giỏ hàng.',
      );
    await stockRepository.recordMovement(
      {
        ingredientId: ingredient._id,
        ingredientName: ingredient.name,
        unit: ingredient.unit,
        type: 'RESERVE',
        quantity: line.quantity,
        onHandAfter: ingredient.onHand,
        reservedAfter: ingredient.reserved,
        reason: 'Giữ nguyên liệu cho đơn mới',
        orderId,
      },
      session,
    );
    await inventoryChanged(ingredient.id, ingredient.version, session);
  }
  return requirements.map((r) => ({ ...r }));
}

export async function settleOrderInventory(
  order: OrderDoc,
  next: string,
  actorId: string | null,
  session: ClientSession,
) {
  if (order.inventoryState !== 'RESERVED' || !['PREPARING', 'CANCELLED'].includes(next)) return;
  const consume = next === 'PREPARING';
  for (const line of order.inventorySnapshot) {
    const ingredient = await stockRepository.settleReserved(
      line.ingredientId,
      line.quantity,
      consume,
      session,
    );
    if (!ingredient)
      throw new ConflictError(
        'INVENTORY_CONFLICT',
        'Không thể đối chiếu lượng nguyên liệu đã giữ. Cần quản trị viên kiểm tra kho.',
      );
    await stockRepository.recordMovement(
      {
        ingredientId: ingredient._id,
        ingredientName: ingredient.name,
        unit: ingredient.unit,
        type: consume ? 'CONSUME' : 'RELEASE',
        quantity: consume ? -line.quantity : line.quantity,
        onHandAfter: ingredient.onHand,
        reservedAfter: ingredient.reserved,
        reason: consume ? 'Xuất nguyên liệu khi bắt đầu pha chế' : 'Trả nguyên liệu giữ do hủy đơn',
        orderId: order._id,
        actorId,
      },
      session,
    );
    await inventoryChanged(ingredient.id, ingredient.version, session);
  }
  order.inventoryState = consume ? 'CONSUMED' : 'RELEASED';
  await orderRepository.saveInventoryState(order, session);
}
