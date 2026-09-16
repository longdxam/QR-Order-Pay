import type { ClientSession } from 'mongoose';
import { BillModel, type BillDoc } from '../models/Bill.js';
import type { TableSessionDoc } from '../models/TableSession.js';
import type { OrderDoc } from '../models/Order.js';
import type { PaymentDoc } from '../models/Payment.js';

export interface FinalizeBillInput {
  tableSession: TableSessionDoc;
  tableCode: string;
  orders: OrderDoc[];
  payments: PaymentDoc[];
  closedAt: Date;
}

export interface IBillRepository {
  finalize(input: FinalizeBillInput, session?: ClientSession | null): Promise<{ bill: BillDoc; created: boolean }>;
  findBySession(tableSessionId: string, session?: ClientSession | null): Promise<BillDoc | null>;
}

export const billRepository: IBillRepository = {
  /**
   * Chốt phiên thành hoá đơn snapshot bất biến.
   * Idempotent: nếu phiên đã có Bill thì trả lại Bill cũ với `created: false`.
   */
  async finalize(
    input: FinalizeBillInput,
    session?: ClientSession | null,
  ): Promise<{ bill: BillDoc; created: boolean }> {
    const tableSessionId = input.tableSession._id.toString();
    const existing = await billRepository.findBySession(tableSessionId, session);
    if (existing) return { bill: existing, created: false };

    const orders = input.orders.filter((o) => o.status !== 'CANCELLED');
    const paidPayments = input.payments.filter((p) => p.status === 'SUCCESS');
    const subtotal = orders.reduce((s, o) => s + o.total, 0);
    const participants = [...new Set(orders.map((o) => o.participantId).filter((p): p is string => !!p))];

    const doc = {
      tableSessionId: input.tableSession._id,
      tableId: input.tableSession.tableId,
      tableCode: input.tableCode,
      source: input.tableSession.source ?? 'STAFF',
      openedAt: input.tableSession.startedAt,
      closedAt: input.closedAt,
      openedBy: input.tableSession.openedBy ?? null,
      closedBy: input.tableSession.closedBy ?? null,
      participants,
      orders: orders.map((o) => ({
        orderId: o._id,
        code: o.code,
        status: o.status,
        paymentStatus: o.paymentStatus,
        total: o.total,
        createdAt: o.createdAt,
        participantId: o.participantId,
        items: o.items.map((i) => ({
          productId: i.productId,
          variantId: i.variantId,
          sizeName: i.sizeName,
          sugarLevel: i.sugarLevel,
          iceLevel: i.iceLevel,
          toppingIds: i.toppingIds,
          toppingNamesSnapshot: i.toppingNamesSnapshot,
          note: i.note,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          lineTotal: i.lineTotal,
          nameSnapshot: i.nameSnapshot,
          variantNameSnapshot: i.variantNameSnapshot,
        })),
      })),
      subtotal,
      total: subtotal,
      paidAmount: paidPayments.reduce((s, p) => s + p.amount, 0),
      paymentIds: paidPayments.map((p) => p._id),
    };

    try {
      const [bill] = await BillModel.create([doc], { session: session ?? undefined });
      if (!bill) throw new Error('Failed to create bill');
      return { bill, created: true };
    } catch (e: unknown) {
      // Thua race với request khác: unique index trên tableSessionId bảo đảm chỉ một Bill.
      if ((e as { code?: number }).code === 11000) {
        const raced = await billRepository.findBySession(tableSessionId, session);
        if (raced) return { bill: raced, created: false };
      }
      throw e;
    }
  },

  async findBySession(tableSessionId: string, session?: ClientSession | null): Promise<BillDoc | null> {
    return BillModel.findOne({ tableSessionId }, null, { session: session ?? undefined });
  },
};
