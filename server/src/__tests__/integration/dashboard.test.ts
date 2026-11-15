import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { OrderModel } from '../../models/Order.js';
import { PaymentModel } from '../../models/Payment.js';
import { CategoryModel } from '../../models/Category.js';
import { ProductModel } from '../../models/Product.js';
import { overview } from '../../services/dashboardService.js';
import { dashboardOverviewSchema, menuSearchRequestSchema } from '@may-cafe/contracts';

let repl: MongoMemoryReplSet;
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(repl.getUri());
  await Promise.all([
    OrderModel.init(),
    PaymentModel.init(),
    CategoryModel.init(),
    ProductModel.init(),
  ]);
}, 120000);
afterAll(async () => {
  await mongoose.disconnect();
  await repl?.stop();
});
beforeEach(async () => {
  await Promise.all([
    OrderModel.deleteMany({}),
    PaymentModel.deleteMany({}),
    CategoryModel.deleteMany({}),
    ProductModel.deleteMany({}),
  ]);
});
async function order(at: string, extra = {}) {
  return OrderModel.create({
    code: randomUUID(),
    tableId: new mongoose.Types.ObjectId(),
    tableSessionId: new mongoose.Types.ObjectId(),
    participantId: randomUUID(),
    items: [],
    total: 90000,
    status: 'SERVED',
    paymentStatus: 'PAID',
    idempotencyKey: randomUUID(),
    requestHash: 'fixture',
    createdAt: new Date(at),
    ...extra,
  });
}
async function receipt(orderId: mongoose.Types.ObjectId, paidAt: string, extra = {}) {
  return PaymentModel.create({
    orderIds: [orderId],
    amount: 90000,
    method: 'BANK_TRANSFER',
    confirmedBy: new mongoose.Types.ObjectId(),
    idempotencyKey: randomUUID(),
    paidAt: new Date(paidAt),
    ...extra,
  });
}
describe('business reporting semantics', () => {
  it('fills every Vietnam day, compares the immediately preceding equal period and explains cross-method refunds without changing history', async () => {
    const prior = await order('2026-10-25T03:00:00Z');
    await receipt(prior._id, '2026-10-25T03:00:00Z');
    const current = await order('2026-10-26T16:59:00Z');
    await receipt(current._id, '2026-10-26T16:59:00Z', {
      status: 'REFUNDED',
      refundedAt: new Date('2026-10-27T03:00:00Z'),
      refundMethod: 'CASH',
    });
    const snapshot = JSON.stringify(await PaymentModel.find().sort({ _id: 1 }).lean());
    const result = dashboardOverviewSchema.parse(
      await overview(new Date('2026-10-26T00:00:00+07:00'), new Date('2026-10-28T00:00:00+07:00')),
    );
    expect(result.revenueByDay).toEqual([
      { date: '2026-10-26', revenue: 90000, orders: 1 },
      { date: '2026-10-27', revenue: -90000, orders: 0 },
      { date: '2026-10-28', revenue: 0, orders: 0 },
    ]);
    expect(result.revenueByHour.find((row) => row.hour === 10)?.revenue).toBe(-90000);
    expect(result.comparison).toMatchObject({
      from: '2026-10-23',
      to: '2026-10-25',
      totalRevenue: 90000,
      ordersCreated: 1,
    });
    expect(result.totalRevenue).toBe(0);
    expect(result.hasFinancialData).toBe(true); // zero net is still real activity
    expect(result.revenueByMethod).toEqual([
      { method: 'BANK_TRANSFER', collected: 90000, refunded: 0, adjustment: 0, revenue: 90000 },
      { method: 'CASH', collected: 0, refunded: 90000, adjustment: 0, revenue: -90000 },
    ]);
    expect(result.revenueByMethod!.reduce((sum, row) => sum + row.revenue, 0)).toBe(
      result.totalRevenue,
    );
    expect(JSON.stringify(await PaymentModel.find().sort({ _id: 1 }).lean())).toBe(snapshot);
  });
  it('counts demand and cancellations independently from collections, and groups saved line values by current category including archived products', async () => {
    const category = await CategoryModel.create({ name: 'Cà phê', slug: 'coffee' });
    const product = await ProductModel.create({
      name: 'Cà phê',
      slug: 'coffee',
      image: '/coffee.webp',
      categoryId: category._id,
      basePrice: 90000,
      isArchived: true,
    });
    const paid = await order('2026-10-26T03:00:00Z', {
      total: 80000,
      items: [
        {
          productId: product._id,
          nameSnapshot: 'Cà phê',
          quantity: 2,
          unitPrice: 45000,
          lineTotal: 90000,
          sugarLevel: '50%',
          iceLevel: 'normal-ice',
        },
      ],
    });
    await receipt(paid._id, '2026-10-26T03:00:00Z', { amount: 80000 });
    await order('2026-10-26T03:30:00Z', { status: 'CANCELLED', paymentStatus: 'UNPAID' });
    await order('2026-10-26T04:00:00Z', { status: 'AWAITING_PAYMENT', paymentStatus: 'UNPAID' });
    const result = await overview(
      new Date('2026-10-26T00:00:00+07:00'),
      new Date('2026-10-26T00:00:00+07:00'),
    );
    expect(result.ordersCreated).toBe(3);
    expect(result.cancelledOrders).toBe(1);
    expect(result.cancellationRate).toBeCloseTo(1 / 3);
    expect(result.orderCount).toBe(1);
    expect(result.ordersByHour).toHaveLength(24);
    expect(result.ordersByHour.find((row) => row.hour === 10)?.orders).toBe(2);
    expect(result.categorySales).toEqual([
      { categoryId: category.id, name: 'Cà phê', quantity: 2, revenue: 90000 },
    ]);
    expect(result.totalRevenue).toBe(80000); // financial net differs from line values before discounts
  });
  it('returns an honest empty period and permits filter-only search without a fabricated word', async () => {
    const result = await overview(
      new Date('2026-12-31T00:00:00+07:00'),
      new Date('2027-01-01T00:00:00+07:00'),
    );
    expect(result.revenueByDay.map((row) => row.date)).toEqual(['2026-12-31', '2027-01-01']);
    expect(result.revenueByDay.every((row) => row.revenue === 0)).toBe(true);
    expect(result.hasFinancialData).toBe(false);
    expect(result.cancellationRate).toBeNull();
    expect(result.categorySales).toEqual([]);
    expect(result.revenueByMethod).toEqual([]);
    expect(menuSearchRequestSchema.parse({ query: '', filters: { noDairy: true } }).query).toBe('');
    expect(
      menuSearchRequestSchema.safeParse({ query: ' ', filters: { noDairy: false } }).success,
    ).toBe(false);
  });
});
