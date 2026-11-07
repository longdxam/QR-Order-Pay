import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../app.js';
import {
  giftCreateSchema,
  placeOrderRequestSchema,
  quoteOrderRequestSchema,
  realtimeEventTypeSchema,
} from '@may-cafe/contracts';
import { priceOrderItems } from '../../services/orderPricingService.js';
import { OrderModel } from '../../models/Order.js';
import { toStaffOrder } from '../../services/orderDto.js';

const app = buildApp();
const id = '507f1f77bcf86cd799439011';
const item = {
  productId: id,
  variantId: null,
  sugarLevel: '50%',
  iceLevel: 'normal-ice',
  toppingIds: [],
  quantity: 1,
};

describe('retired feature entry points', () => {
  it('keeps legacy fulfillment and recipe snapshots readable without changing financial or stored data', () => {
    const order = new OrderModel({
      code: 'LEGACY01',
      participantId: 'member:old',
      fulfillmentType: 'PICKUP',
      pickup: { name: 'Khách cũ', phone: '0901234567', outcome: 'COLLECTED' },
      items: [
        {
          ...item,
          nameSnapshot: 'Công thức cũ',
          unitPrice: 30000,
          lineTotal: 30000,
          freestyle: {
            name: 'Công thức cũ',
            instructions: 'Pha theo công thức đã chốt',
            components: [{ ingredientId: id, name: 'Sữa', unit: 'ml', quantity: 100000 }],
          },
        },
      ],
      total: 30000,
      paidAmount: 30000,
      status: 'SERVED',
      paymentStatus: 'PAID',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const before = JSON.stringify(order.toObject());
    const dto = toStaffOrder(order);
    expect(dto.fulfillmentType).toBe('PICKUP');
    expect(dto.total).toBe(30000);
    expect(dto.paidAmount).toBe(30000);
    expect(dto.items[0]?.freestyle?.components).toEqual([
      { name: 'Sữa', unit: 'ml', quantity: 100 },
    ]);
    expect(JSON.stringify(order.toObject())).toBe(before);
  });
  it('returns 404 for every removed API including direct actions and private photo endpoints', async () => {
    const endpoints: Array<readonly ['get' | 'post' | 'put' | 'patch', string]> = [
      ['get', '/game'],
      ['post', '/game'],
      ...['join', 'leave', 'spin', 'cancel', 'add-player', 'remove-player', 'continue'].map(
        (action) => ['post', `/game/${id}/${action}`] as const,
      ),
      ['get', '/recommendations/companions'],
      ['get', '/admin/insights'],
      ['get', '/ai/freestyle'],
      ['post', '/ai/freestyle'],
      ['post', '/ai/freestyle/validate'],
      ['get', '/admin/freestyle'],
      ['put', '/admin/freestyle'],
    ];
    for (const prefix of ['/pickups', '/staff/pickups', '/admin/pickups']) {
      endpoints.push(
        ['get', prefix],
        ['post', prefix],
        ['get', `${prefix}/catalog`],
        ['post', `${prefix}/quote`],
      );
      for (const action of ['cancel', 'no-show', 'payments', 'refund'])
        endpoints.push(['post', `${prefix}/${id}/${action}`]);
      endpoints.push(['patch', `${prefix}/${id}/status`], ['get', `${prefix}/${id}/bill`]);
    }
    endpoints.push(
      ['post', '/pickup/cup-photos'],
      ['get', `/pickup/cup-photos/${id}`],
      ['get', `/pickup/cup-photos/${id}/details`],
      ['post', `/pickup/cup-photos/${id}/latte-art`],
    );
    for (const [method, path] of endpoints) {
      const response = await request(app)[method](`/api/v1${path}`).send({});
      expect(response.status, `${method.toUpperCase()} ${path}`).toBe(404);
    }
    expect((await request(app).get('/api/v1/health')).status).toBe(200);
    for (const path of [
      '/staff/orders',
      '/staff/cash-shifts/current',
      '/staff/jukebox',
      '/admin/reports/overview',
      '/admin/inventory',
    ])
      expect((await request(app).get(`/api/v1${path}`)).status, path).toBe(401);
  });

  it('rejects stale Freestyle payloads for table quotes, orders and gifts without falling back to catalog pricing', async () => {
    const stale = { ...item, freestyleToken: 'old-signed-freestyle-token' };
    for (const schema of [placeOrderRequestSchema, quoteOrderRequestSchema]) {
      expect(schema.safeParse({ items: [item] }).success).toBe(true);
      expect(schema.safeParse({ items: [stale] }).success).toBe(false);
    }
    const gift = {
      requestId: 'b8195819-0467-4531-a23c-819a80f7214a',
      recipientTableId: id,
      recipientSessionId: id,
    };
    expect(giftCreateSchema.safeParse({ ...gift, items: [item] }).success).toBe(true);
    expect(giftCreateSchema.safeParse({ ...gift, items: [stale] }).success).toBe(false);
    await expect(priceOrderItems([stale])).rejects.toMatchObject({ status: 422 });
    expect(realtimeEventTypeSchema.options).not.toContain('game.changed');
  });
});
