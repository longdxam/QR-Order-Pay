import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { OrderModel } from '../../models/Order.js';
import { TableSessionModel } from '../../models/TableSession.js';
import { orderRepository } from '../../repositories/orderRepository.js';
import { operationsSummary } from '../../services/operationsService.js';

let repl: MongoMemoryReplSet;
let sequence = 0;
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(repl.getUri());
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
}, 120000);
beforeEach(async () => {
  await Promise.all([OrderModel.deleteMany({}), TableSessionModel.deleteMany({})]);
  sequence = 0;
});
afterAll(async () => {
  await mongoose.disconnect();
  await repl.stop();
});

function session(status: 'OPEN' | 'CHECKOUT' | 'CLOSED') {
  return TableSessionModel.create({ tableId: new Types.ObjectId(), status });
}
function order(fields: Record<string, unknown> = {}) {
  const key = `OPS-${++sequence}`;
  return OrderModel.create({
    code: key,
    participantId: key,
    idempotencyKey: key,
    requestHash: key,
    total: 10000,
    items: [],
    tableId:
      fields.fulfillmentType && fields.fulfillmentType !== 'DINE_IN' ? null : new Types.ObjectId(),
    status: 'PENDING',
    paymentStatus: 'PAID',
    ...fields,
  });
}

describe('operational order counters share the KDS scope', () => {
  it('excludes orphaned history, closed sessions, unpaid and terminal orders without changing records', async () => {
    const open = await session('OPEN');
    const checkout = await session('CHECKOUT');
    const closed = await session('CLOSED');
    const old = new Date('2026-08-01T00:00:00Z');
    for (const status of ['PENDING', 'CONFIRMED', 'PREPARING', 'READY']) {
      await order({ status, tableSessionId: new Types.ObjectId(), createdAt: old });
      await order({ status, tableSessionId: closed._id, createdAt: old });
    }
    await order({ tableSessionId: open._id, paymentStatus: 'UNPAID' });
    await order({ tableSessionId: checkout._id, paymentStatus: 'REFUNDED' });
    await order({ tableSessionId: open._id, status: 'SERVED' });
    await order({ tableSessionId: open._id, status: 'CANCELLED' });
    const before = await OrderModel.find().lean();
    const summary = await operationsSummary();
    expect(summary.database).toMatchObject({
      activeSessions: 2,
      activeOrders: 0,
      ordersByStatus: { PENDING: 0, CONFIRMED: 0, PREPARING: 0, READY: 0 },
      oldestQueuedAt: null,
      oldestQueueAgeSeconds: 0,
    });
    expect(
      await orderRepository.listForStaff({ tableSessionIds: [open.id, checkout.id] }),
    ).toHaveLength(0);
    expect(await OrderModel.find().lean()).toEqual(before);
  });

  it('counts paid orders in both OPEN and CHECKOUT sessions, including aggregation ObjectId matches', async () => {
    const open = await session('OPEN');
    const checkout = await session('CHECKOUT');
    const oldest = new Date(Date.now() - 120000);
    const created = [];
    for (const [index, status] of ['PENDING', 'CONFIRMED', 'PREPARING', 'READY'].entries()) {
      created.push(
        await order({
          status,
          tableSessionId: index % 2 ? checkout._id : open._id,
          createdAt: new Date(oldest.getTime() + index * 10000),
        }),
      );
    }
    const summary = await operationsSummary();
    expect(summary.database.activeOrders).toBe(4);
    expect(summary.database.ordersByStatus).toEqual({
      PENDING: 1,
      CONFIRMED: 1,
      PREPARING: 1,
      READY: 1,
    });
    expect(summary.database.oldestQueuedAt).toBe(oldest.toISOString());
    expect(summary.database.oldestQueueAgeSeconds).toBeGreaterThanOrEqual(120);
    const kds = await orderRepository.listForStaff({ tableSessionIds: [open.id, checkout.id] });
    expect(kds.map((row) => row.id).sort()).toEqual(created.map((row) => row.id).sort());
  });

  it('includes eligible takeaway and pickup orders but excludes future, unpaid, no-show and collected orders', async () => {
    const pickup = (outcome: string, minutes = 0) => ({
      name: 'Khách thử',
      phone: '0901234567',
      outcome,
      scheduledAt: minutes ? new Date(Date.now() + minutes * 60000) : null,
    });
    const active = [
      await order({ fulfillmentType: 'TAKEAWAY', pickup: pickup('ACTIVE') }),
      await order({ fulfillmentType: 'PICKUP', pickup: pickup('ACTIVE'), status: 'CONFIRMED' }),
      await order({ fulfillmentType: 'PICKUP', pickup: pickup('ACTIVE', 10), status: 'PREPARING' }),
    ];
    await order({ fulfillmentType: 'PICKUP', pickup: pickup('ACTIVE', 20) });
    await order({ fulfillmentType: 'PICKUP', pickup: pickup('NO_SHOW') });
    await order({ fulfillmentType: 'TAKEAWAY', pickup: pickup('COLLECTED') });
    await order({ fulfillmentType: 'PICKUP', pickup: pickup('ACTIVE'), paymentStatus: 'UNPAID' });
    await order({ fulfillmentType: 'PICKUP', pickup: pickup('ACTIVE'), status: 'SERVED' });
    const summary = await operationsSummary();
    expect(summary.database.activeSessions).toBe(0);
    expect(summary.database.activeOrders).toBe(3);
    expect(summary.database.ordersByStatus).toEqual({
      PENDING: 1,
      CONFIRMED: 1,
      PREPARING: 1,
      READY: 0,
    });
    const kds = await orderRepository.listForStaff({ tableSessionIds: [] });
    expect(kds.map((row) => row.id).sort()).toEqual(active.map((row) => row.id).sort());
  });
});
