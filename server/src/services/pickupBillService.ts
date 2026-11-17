import type { ClientSession } from 'mongoose';
import type { OrderDoc } from '../models/Order.js';
import { billRepository } from '../repositories/billRepository.js';
import { paymentRepository } from '../repositories/paymentRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { randomShortCode } from '../utils/crypto.js';

/** Legacy settlement only: preserve invoices for pickup orders created before retirement. */
export async function finalizePickupBill(order: OrderDoc, actorId: string, session: ClientSession) {
  const existing = await billRepository.findByPickupOrder(order._id, session);
  if (existing) return existing;
  const payments = await paymentRepository.listSuccessfulForOrder(order._id, session);
  const cashier = await userRepository.findById(actorId, session);
  const now = new Date();
  return billRepository.createPickupBill(
    {
      invoiceCode: `HD${now.toISOString().slice(0, 10).replaceAll('-', '')}-${randomShortCode(6)}`,
      pickupOrderId: order._id,
      tableSessionId: null,
      tableId: null,
      tableCode: order.code,
      tableName: order.fulfillmentType === 'PICKUP' ? 'Đặt trước nhận tại quầy' : 'Mang đi',
      cashierName: cashier?.name ?? 'Nhân viên',
      source: order.pickup?.createdBy ? 'STAFF' : 'GUEST',
      openedAt: order.createdAt,
      closedAt: now,
      closedBy: actorId,
      participants: [order.participantId],
      orders: [{ ...order.toObject(), orderId: order._id }],
      subtotal: order.subtotal ?? order.total,
      total: order.total,
      paidAmount: payments.reduce((sum, p) => sum + p.amount, 0),
      paymentIds: payments.map((p) => p._id),
      payments: payments.map((p) => ({
        paymentId: p._id,
        method: p.method,
        amount: p.amount,
        paidAt: p.paidAt,
      })),
    },
    session,
  );
}
