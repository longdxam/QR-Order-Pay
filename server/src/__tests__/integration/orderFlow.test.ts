import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { buildApp } from '../../app.js';
import { UserModel } from '../../models/User.js';
import { TableModel } from '../../models/Table.js';
import { CategoryModel } from '../../models/Category.js';
import { ProductModel } from '../../models/Product.js';
import { ToppingModel } from '../../models/Topping.js';
import { hashPassword, randomToken, sha256 } from '../../utils/crypto.js';
import request from 'supertest';
import { createServer, type Server } from 'node:http';
import { io as connectSocket, type Socket } from 'socket.io-client';
import { createSocketServer } from '../../realtime/socket.js';
import { TableSessionModel } from '../../models/TableSession.js';
import { GuestSessionModel } from '../../models/GuestSession.js';
import { PaymentModel } from '../../models/Payment.js';
import { AIService } from '../../services/aiService.js';
import { ReviewModel } from '../../models/Review.js';
import { OrderModel } from '../../models/Order.js';
import { BillModel } from '../../models/Bill.js';
import { AuditLogModel } from '../../models/AuditLog.js';
import { config } from '../../config/index.js';
import { getInstanceMetricsSnapshot } from '../../infrastructure/metrics.js';
import { persistAnomalyAlert, runAnomalyDetection } from '../../services/anomalyService.js';
import { AnomalyAlertModel } from '../../models/AnomalyAlert.js';

let httpServer: Server;
let socketServer: ReturnType<typeof createSocketServer>;
let socketUrl = '';
const clients: Socket[] = [];

let replSet: MongoMemoryReplSet;
let app: ReturnType<typeof buildApp>;
let staffAccess = '';
let tableId = '';
let tableToken = '';

async function seedBasic() {
  await Promise.all(
    Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})),
  );
  await Promise.all([
    UserModel.deleteMany({}),
    TableModel.deleteMany({}),
    CategoryModel.deleteMany({}),
    ProductModel.deleteMany({}),
    ToppingModel.deleteMany({}),
  ]);
  const passwordHash = await hashPassword('Password@123');
  await UserModel.create({
    name: 'Admin',
    email: 'admin@test.vn',
    passwordHash,
    role: 'ADMIN',
    isActive: true,
  });
  await UserModel.create({
    name: 'Staff',
    email: 'staff@test.vn',
    passwordHash,
    role: 'STAFF',
    isActive: true,
  });
  const cat = await CategoryModel.create({
    name: 'Cà phê',
    slug: 'cafe',
    sortOrder: 0,
    isActive: true,
  });
  const topping = await ToppingModel.create({
    name: 'Trân châu đen',
    price: 8000,
    isAvailable: true,
    isArchived: false,
  });
  await ProductModel.create({
    categoryId: cat._id,
    name: 'Espresso Mây',
    slug: 'espresso-may',
    description: '',
    image: 'https://example.com/x.jpg',
    basePrice: 35000,
    variants: [
      { name: 'S', price: 35000, isAvailable: true },
      { name: 'M', price: 45000, isAvailable: true },
    ],
    allowedOptions: {
      sizes: ['S', 'M'],
      sugarLevels: ['0%', '50%', '100%'],
      iceLevels: ['less-ice', 'normal-ice'],
      toppingIds: [topping._id.toString()],
    },
    toppingIds: [topping._id.toString()],
    tags: [],
    ingredientMetadata: { caffeine: true, dairy: false, flavorProfile: ['đắng'] },
    isAvailable: true,
    isArchived: false,
    sortOrder: 0,
  });
  tableToken = randomToken(24);
  const table = await TableModel.create({
    code: 'B01',
    name: 'Bàn 01',
    capacity: 4,
    publicTokenHash: sha256(tableToken),
    isActive: true,
  });
  tableId = table._id.toString();
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = replSet.getUri();
  await mongoose.connect(uri);
  app = buildApp();
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  httpServer = createServer(app);
  socketServer = createSocketServer(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address');
  socketUrl = `http://127.0.0.1:${address.port}`;
}, 120_000);

afterAll(async () => {
  if (socketServer) await new Promise<void>((resolve) => socketServer.close(() => resolve()));
  await mongoose.disconnect();
  await replSet.stop();
});

afterEach(() => {
  for (const socket of clients.splice(0)) socket.disconnect();
});

beforeEach(async () => {
  await seedBasic();
  const loginRes = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'staff@test.vn', password: 'Password@123' });
  staffAccess = loginRes.body.data.accessToken;
});

describe('order flow integration', () => {
  it('searches the real menu with strict per-item budget and dairy constraints', async () => {
    const response = await request(app)
      .post('/api/v1/menu/search')
      .send({ query: 'ca phe khong sua duoi 40 nghin' });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      mode: 'fallback',
      intent: {
        requirements: {
          noCaffeine: false,
          noDairy: true,
          includedGroups: ['coffee'],
          excludedGroups: [],
          budget: { maxVnd: 40_000, inclusive: false, scope: 'item' },
        },
      },
    });
    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0]).toMatchObject({ name: 'Espresso Mây', unitPrice: 35_000 });

    const product = await ProductModel.findById(response.body.data.items[0].productId).lean();
    expect(product?.ingredientMetadata?.dairy).toBe(false);
    expect(
      response.body.data.items.every((item: { unitPrice: number }) => item.unitPrice < 40_000),
    ).toBe(true);
    expect((await request(app).post('/api/v1/menu/search').send({ query: '' })).status).toBe(422);
  });

  it('exposes anomaly evidence to admins and audits acknowledgement', async () => {
    const detectionNow = new Date();
    const product = (await ProductModel.findOne())!;
    const syntheticOrders = [];
    const order = (
      index: number,
      createdAt: Date,
      status: 'READY' | 'CANCELLED',
      statusHistory: Array<{ from: string | null; to: string; at: Date }>,
    ) => ({
      code: `SYN-${index}`,
      tableSessionId: new mongoose.Types.ObjectId(),
      participantId: `synthetic-${index}`,
      tableId,
      items: [
        {
          productId: product._id,
          variantId: product.variants[0]!._id,
          sizeName: 'S',
          sugarLevel: '0%',
          iceLevel: 'normal-ice',
          toppingIds: [],
          toppingNamesSnapshot: [],
          note: '',
          quantity: 1,
          unitPrice: 35_000,
          lineTotal: 35_000,
          nameSnapshot: product.name,
          variantNameSnapshot: 'S',
        },
      ],
      total: 35_000,
      status,
      paymentStatus: 'UNPAID',
      statusHistory,
      idempotencyKey: `synthetic-${index}`,
      requestHash: `hash-${index}`,
      version: 0,
      createdAt,
      updatedAt: createdAt,
    });
    for (let index = 0; index < 20; index += 1) {
      const baselineCreated = new Date(detectionNow.getTime() - 40 * 60_000 + index);
      const currentCreated = new Date(detectionNow.getTime() - 10 * 60_000 + index);
      syntheticOrders.push(
        order(
          index,
          baselineCreated,
          index === 0 ? 'CANCELLED' : 'READY',
          index === 0
            ? [
                {
                  from: 'PENDING',
                  to: 'CANCELLED',
                  at: new Date(detectionNow.getTime() - 30 * 60_000),
                },
              ]
            : [],
        ),
      );
      syntheticOrders.push(
        order(
          100 + index,
          currentCreated,
          index < 8 ? 'CANCELLED' : 'READY',
          index < 8
            ? [
                {
                  from: 'PENDING',
                  to: 'CANCELLED',
                  at: new Date(detectionNow.getTime() - 5 * 60_000),
                },
              ]
            : [],
        ),
      );
      const baselineReady = new Date(detectionNow.getTime() - 30 * 60_000 + index);
      syntheticOrders.push(
        order(200 + index, new Date(detectionNow.getTime() - 80 * 60_000), 'READY', [
          { from: 'CONFIRMED', to: 'PREPARING', at: new Date(baselineReady.getTime() - 300_000) },
          { from: 'PREPARING', to: 'READY', at: baselineReady },
        ]),
      );
      const currentReady = new Date(detectionNow.getTime() - 60_000 + index);
      syntheticOrders.push(
        order(300 + index, new Date(detectionNow.getTime() - 20 * 60_000), 'READY', [
          { from: 'CONFIRMED', to: 'PREPARING', at: new Date(currentReady.getTime() - 1_140_000) },
          { from: 'PREPARING', to: 'READY', at: currentReady },
        ]),
      );
    }
    await OrderModel.insertMany(syntheticOrders);
    const evaluated = await runAnomalyDetection(detectionNow);
    expect(evaluated.filter((item) => item.state === 'ALERT').map((item) => item.detector)).toEqual(
      ['PREPARATION_P95', 'CANCELLATION_RATE'],
    );
    const adminLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@test.vn', password: 'Password@123' });
    const adminAccess = adminLogin.body.data.accessToken as string;
    const dashboard = await request(app)
      .get('/api/v1/admin/anomalies')
      .set('Authorization', `Bearer ${adminAccess}`);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.data.evaluations).toHaveLength(4);
    expect(dashboard.body.data.alerts).toHaveLength(2);
    expect(
      (
        await request(app)
          .get('/api/v1/admin/anomalies')
          .set('Authorization', `Bearer ${staffAccess}`)
      ).status,
    ).toBe(403);

    const now = new Date();
    const evaluation = {
      detector: 'HTTP_ERROR_RATE' as const,
      target: 'all',
      state: 'ALERT' as const,
      severity: 'WARNING' as const,
      windowStart: new Date(now.getTime() - 900_000).toISOString(),
      windowEnd: now.toISOString(),
      observedValue: 0.3,
      thresholdValue: 0.1,
      baselineValue: 0.01,
      sampleCount: 40,
      baselineSampleCount: 40,
      method: 'integration synthetic evidence',
      evidence: { errors: 12, requests: 40 },
    };
    expect(await persistAnomalyAlert(evaluation, now, false)).toBe(true);
    expect(
      await persistAnomalyAlert(
        { ...evaluation, windowEnd: new Date(now.getTime() + 60_000).toISOString() },
        new Date(now.getTime() + 60_000),
        false,
      ),
    ).toBe(false);
    expect(
      await AnomalyAlertModel.countDocuments({ detector: 'HTTP_ERROR_RATE', target: 'all' }),
    ).toBe(1);
    const alert = (await AnomalyAlertModel.findOne({
      detector: 'HTTP_ERROR_RATE',
      target: 'all',
    }))!;
    const acknowledged = await request(app)
      .patch(`/api/v1/admin/anomalies/${alert.id}/status`)
      .set('Authorization', `Bearer ${adminAccess}`)
      .send({ status: 'ACKNOWLEDGED' });
    expect(acknowledged.status).toBe(200);
    expect(acknowledged.body.data.alert.status).toBe('ACKNOWLEDGED');
    expect(
      await AuditLogModel.exists({ action: 'anomaly.acknowledged', entityId: alert.id }),
    ).toBeTruthy();
    const closed = await request(app)
      .patch(`/api/v1/admin/anomalies/${alert.id}/status`)
      .set('Authorization', `Bearer ${adminAccess}`)
      .send({ status: 'CLOSED' });
    expect(closed.status).toBe(200);
    expect(
      await AuditLogModel.exists({ action: 'anomaly.closed', entityId: alert.id }),
    ).toBeTruthy();
    expect(
      (
        await request(app)
          .patch(`/api/v1/admin/anomalies/${alert.id}/status`)
          .set('Authorization', `Bearer ${adminAccess}`)
          .send({ status: 'ACKNOWLEDGED' })
      ).status,
    ).toBe(404);
  });

  it('lists review statistics for admins only and applies rating/date filters', async () => {
    await ReviewModel.create([
      {
        orderId: new mongoose.Types.ObjectId(),
        tableSessionId: new mongoose.Types.ObjectId(),
        participantId: 'guest-1',
        rating: 5,
        comment: 'Rất ngon',
      },
      {
        orderId: new mongoose.Types.ObjectId(),
        tableSessionId: new mongoose.Types.ObjectId(),
        participantId: 'guest-2',
        rating: 3,
        comment: 'Ổn',
      },
    ]);
    const adminLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@test.vn', password: 'Password@123' });
    const adminAccess = adminLogin.body.data.accessToken as string;
    const all = await request(app)
      .get('/api/v1/admin/reviews')
      .set('Authorization', `Bearer ${adminAccess}`);
    expect(all.status).toBe(200);
    expect(all.body.data).toMatchObject({ total: 2, averageRating: 4 });
    expect(
      all.body.data.distribution.find((item: { rating: number }) => item.rating === 5).count,
    ).toBe(1);
    const filtered = await request(app)
      .get('/api/v1/admin/reviews?rating=5')
      .set('Authorization', `Bearer ${adminAccess}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.data).toMatchObject({ total: 1, averageRating: 5 });
    expect(
      (
        await request(app)
          .get('/api/v1/admin/reviews')
          .set('Authorization', `Bearer ${staffAccess}`)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .get('/api/v1/admin/reviews?rating=9')
          .set('Authorization', `Bearer ${adminAccess}`)
      ).status,
    ).toBe(422);
  });

  it('aggregates dashboard data beyond the repository page limit and filters by date', async () => {
    const product = (await ProductModel.findOne())!;
    const createdAt = new Date();
    await OrderModel.insertMany(
      Array.from({ length: 105 }, (_, index) => ({
        code: `REPORT-${index}`,
        tableSessionId: new mongoose.Types.ObjectId(),
        participantId: `report-guest-${index}`,
        tableId,
        items: [
          {
            productId: product._id,
            variantId: product.variants[0]!._id,
            sizeName: 'S',
            sugarLevel: '0%',
            iceLevel: 'normal-ice',
            toppingIds: [],
            toppingNamesSnapshot: [],
            note: '',
            quantity: 1,
            unitPrice: 35_000,
            lineTotal: 35_000,
            nameSnapshot: product.name,
            variantNameSnapshot: 'S',
          },
        ],
        total: 35_000,
        status: 'SERVED',
        paymentStatus: 'PAID',
        statusHistory: [],
        idempotencyKey: `report-${index}`,
        requestHash: `report-hash-${index}`,
        version: 0,
        createdAt,
        updatedAt: createdAt,
      })),
    );

    const adminLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@test.vn', password: 'Password@123' });
    const adminAccess = adminLogin.body.data.accessToken as string;
    const dateParts = new Intl.DateTimeFormat('en', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(createdAt)
      .reduce<Record<string, string>>((parts, part) => ({ ...parts, [part.type]: part.value }), {});
    const date = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
    const response = await request(app)
      .get(`/api/v1/admin/reports/overview?from=${date}&to=${date}`)
      .set('Authorization', `Bearer ${adminAccess}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      totalRevenue: 105 * 35_000,
      orderCount: 105,
      averageOrderValue: 35_000,
    });
    expect(response.body.data.topProducts[0]).toMatchObject({
      name: 'Espresso Mây',
      quantity: 105,
      revenue: 105 * 35_000,
    });
    expect(response.body.data.revenueByDay).toEqual([{ date, revenue: 105 * 35_000, orders: 105 }]);
  });

  function cookies(res: { headers: Record<string, unknown> }): string {
    return (res.headers['set-cookie'] as string[]).map((c) => c.split(';')[0]).join('; ');
  }
  async function startVisit() {
    const opened = await request(app)
      .post(`/api/v1/staff/tables/${tableId}/sessions`)
      .set('Authorization', `Bearer ${staffAccess}`);
    expect(opened.status).toBe(200);
    const joined = await request(app).post('/api/v1/table-sessions/join').send({ tableToken });
    expect(joined.status).toBe(200);
    const product = (await ProductModel.findOne())!;
    const payload = {
      items: [
        {
          productId: product.id,
          variantId: product.variants[0]!._id!.toString(),
          sugarLevel: '50%',
          iceLevel: 'normal-ice',
          toppingIds: [],
          quantity: 1,
        },
      ],
    };
    return {
      cookie: cookies(joined),
      sessionId: opened.body.data.session._id as string,
      payload,
      participantId: joined.body.data.participantId as string,
    };
  }
  async function place(cookie: string, payload: object, key = randomToken(16)) {
    const res = await request(app)
      .post('/api/v1/orders')
      .set('Cookie', cookie)
      .set('Idempotency-Key', key)
      .send(payload);
    expect(res.status).toBe(201);
    return res.body.data.order as { _id: string; total: number };
  }
  async function serve(id: string) {
    for (const status of ['CONFIRMED', 'PREPARING', 'READY', 'SERVED']) {
      const res = await request(app)
        .patch(`/api/v1/staff/orders/${id}/status`)
        .set('Authorization', `Bearer ${staffAccess}`)
        .send({ status });
      expect(res.status).toBe(200);
    }
  }
  async function checkout(sessionId: string) {
    const session = (await TableSessionModel.findById(sessionId))!;
    const res = await request(app)
      .patch(`/api/v1/staff/table-sessions/${sessionId}/status`)
      .set('Authorization', `Bearer ${staffAccess}`)
      .send({ status: 'CHECKOUT', expectedVersion: session.version });
    expect(res.status).toBe(200);
    return res.body.data.session.version as number;
  }
  function pay(sessionId: string, amount: number, version: number, key: string) {
    return request(app)
      .post(`/api/v1/staff/table-sessions/${sessionId}/payments`)
      .set('Authorization', `Bearer ${staffAccess}`)
      .set('Idempotency-Key', key)
      .send({ amount, expectedVersion: version, method: 'CASH' });
  }
  function event<T = unknown>(socket: Socket, name: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.off(name, handler);
        reject(new Error(`Timeout: ${name}`));
      }, 5000);
      const handler = (data: T) => {
        clearTimeout(timeout);
        resolve(data);
      };
      socket.once(name, handler);
    });
  }
  async function guestSocket(cookie: string): Promise<Socket> {
    const socket = connectSocket(socketUrl, {
      autoConnect: false,
      transports: ['websocket'],
      extraHeaders: { Cookie: cookie },
      auth: { role: 'GUEST' },
      reconnection: false,
    });
    clients.push(socket);
    const connected = event(socket, 'connect');
    socket.connect();
    await connected;
    return socket;
  }

  it('completes two-guest payment, receipt and review flow without reopening ordering rights', async () => {
    const { cookie, sessionId, payload, participantId } = await startVisit();
    const tables = await request(app)
      .get('/api/v1/staff/tables')
      .set('Authorization', `Bearer ${staffAccess}`);
    expect(tables.status).toBe(200);
    expect(tables.body.data.tables[0]).not.toHaveProperty('publicTokenHash');
    expect(
      (await request(app).get('/api/v1/admin/tables').set('Authorization', `Bearer ${staffAccess}`))
        .status,
    ).toBe(403);
    const current = await request(app).get('/api/v1/table-sessions/current').set('Cookie', cookie);
    expect(current.body.data.table.name).toBe('Bàn 01');
    const rejoin = await request(app)
      .post('/api/v1/table-sessions/join')
      .set('Cookie', cookie)
      .send({ tableToken });
    expect(rejoin.body.data.participantId).toBe(participantId);
    const second = await request(app).post('/api/v1/table-sessions/join').send({ tableToken });
    const secondCookie = cookies(second);
    const firstOrder = await place(cookie, payload);
    const secondOrder = await place(secondCookie, payload);
    expect((await request(app).get('/api/v1/receipts/current').set('Cookie', cookie)).status).toBe(
      401,
    );
    await serve(firstOrder._id);
    await serve(secondOrder._id);
    expect(
      (
        await request(app)
          .post(`/api/v1/orders/${firstOrder._id}/review`)
          .set('Cookie', cookie)
          .send({ rating: 5 })
      ).status,
    ).toBe(422);
    await request(app)
      .post('/api/v1/service-requests')
      .set('Cookie', cookie)
      .send({ type: 'REQUEST_BILL' });
    const version = await checkout(sessionId);
    const amount = firstOrder.total + secondOrder.total;
    expect((await pay(sessionId, 0, version, 'payment-wrong-amount')).status).toBe(422);
    const paid = await pay(sessionId, amount, version, 'payment-complete');
    expect(paid.status).toBe(201);
    const replay = await pay(sessionId, amount, version, 'payment-complete');
    expect(replay.status).toBe(200);
    expect(replay.body.data.payment._id).toBe(paid.body.data.payment._id);
    expect((await pay(sessionId, amount + 1, version, 'payment-complete')).status).toBe(409);
    expect(await PaymentModel.countDocuments({ tableSessionId: sessionId })).toBe(1);
    expect(
      await GuestSessionModel.countDocuments({ tableSessionId: sessionId, revokedAt: null }),
    ).toBe(0);
    expect(
      (
        await request(app)
          .post('/api/v1/orders')
          .set('Cookie', cookie)
          .set('Idempotency-Key', 'old-guest-order')
          .send(payload)
      ).status,
    ).toBe(401);
    const receipt = await request(app).get('/api/v1/receipts/current').set('Cookie', cookie);
    expect(receipt.status).toBe(200);
    expect(receipt.body.data.orders.map((o: { _id: string }) => o._id)).toEqual([firstOrder._id]);
    expect(receipt.body.data.total).toBe(firstOrder.total);
    expect(
      (
        await request(app)
          .post(`/api/v1/receipts/orders/${secondOrder._id}/review`)
          .set('Cookie', cookie)
          .send({ rating: 5 })
      ).status,
    ).toBe(403);
    const review = await request(app)
      .post(`/api/v1/receipts/orders/${firstOrder._id}/review`)
      .set('Cookie', cookie)
      .send({ rating: 5, comment: 'Ngon!' });
    expect(review.status).toBe(201);
    expect(
      (
        await request(app)
          .post(`/api/v1/receipts/orders/${firstOrder._id}/review`)
          .set('Cookie', cookie)
          .send({ rating: 4 })
      ).status,
    ).toBe(409);
    expect(
      (await request(app).get('/api/v1/receipts/current').set('Cookie', cookie)).body.data.orders[0]
        .review.rating,
    ).toBe(5);
    expect(
      (await request(app).get('/api/v1/table-sessions/current').set('Cookie', cookie)).body.data,
    ).toMatchObject({ active: false, receiptAvailable: true });
    const requests = await request(app)
      .get('/api/v1/staff/service-requests')
      .set('Authorization', `Bearer ${staffAccess}`);
    expect(requests.body.data.items).toHaveLength(0);
    await GuestSessionModel.updateMany({ tableSessionId: sessionId }, { expiresAt: new Date(0) });
    expect((await request(app).get('/api/v1/receipts/current').set('Cookie', cookie)).status).toBe(
      401,
    );
  });

  it('prevents closing unpaid sessions, paying unfinished orders and ordering during checkout', async () => {
    const { cookie, sessionId, payload } = await startVisit();
    const order = await place(cookie, payload);
    const current = (await TableSessionModel.findById(sessionId))!;
    const close = await request(app)
      .patch(`/api/v1/staff/table-sessions/${sessionId}/status`)
      .set('Authorization', `Bearer ${staffAccess}`)
      .send({ status: 'CLOSED', expectedVersion: current.version });
    expect(close.status).toBe(403);
    expect((await TableSessionModel.findById(sessionId))!.status).toBe('OPEN');
    expect((await pay(sessionId, order.total, current.version, 'pay-before-checkout')).status).toBe(
      403,
    );
    const version = await checkout(sessionId);
    expect((await pay(sessionId, order.total, version, 'pay-unfinished')).status).toBe(422);
    expect(
      (
        await request(app)
          .post('/api/v1/orders')
          .set('Cookie', cookie)
          .set('Idempotency-Key', 'checkout-order')
          .send(payload)
      ).status,
    ).toBe(403);
  });

  it('closes an empty table, invalidates receipt access on leave and opens a fresh visit', async () => {
    const { cookie, sessionId } = await startVisit();
    await request(app)
      .post('/api/v1/service-requests')
      .set('Cookie', cookie)
      .send({ type: 'CALL_STAFF' });
    const closed = await request(app)
      .patch(`/api/v1/staff/table-sessions/${sessionId}/status`)
      .set('Authorization', `Bearer ${staffAccess}`)
      .send({ status: 'CLOSED', expectedVersion: 0 });
    expect(closed.status).toBe(200);
    expect((await request(app).get('/api/v1/receipts/current').set('Cookie', cookie)).status).toBe(
      200,
    );
    expect(
      (await request(app).post('/api/v1/table-sessions/leave').set('Cookie', cookie)).status,
    ).toBe(200);
    expect((await request(app).get('/api/v1/receipts/current').set('Cookie', cookie)).status).toBe(
      401,
    );
    const next = await startVisit();
    expect(next.sessionId).not.toBe(sessionId);
    expect(
      (await request(app).get('/api/v1/table-sessions/current').set('Cookie', cookie)).body.data
        .active,
    ).toBe(false);
  });

  it('authenticates realtime with HttpOnly cookies and publishes through the full order lifecycle', async () => {
    const { cookie, sessionId, payload, participantId } = await startVisit();
    const guest = await guestSocket(cookie);
    const serverGuest = socketServer.sockets.sockets.get(guest.id!)!;
    expect(serverGuest.rooms.has(`guest:${sessionId}:${participantId}`)).toBe(true);
    expect(serverGuest.rooms.has('staff')).toBe(false);
    const staff = connectSocket(socketUrl, {
      autoConnect: false,
      transports: ['websocket'],
      auth: { role: 'STAFF', accessToken: staffAccess },
      reconnection: false,
    });
    clients.push(staff);
    const connected = event(staff, 'connect');
    staff.connect();
    await connected;
    const created = event<{ orderId: string }>(staff, 'order.created');
    const order = await place(cookie, payload);
    expect((await created).orderId).toBe(order._id);
    const changed = event<{ status: string }>(guest, 'order.statusChanged');
    await serve(order._id);
    expect((await changed).status).toBe('CONFIRMED');
    const requested = event(staff, 'serviceRequest.created');
    await request(app)
      .post('/api/v1/service-requests')
      .set('Cookie', cookie)
      .send({ type: 'CALL_STAFF' });
    await requested;
    const version = await checkout(sessionId);
    const payment = event(guest, 'payment.confirmed');
    const disconnected = event(guest, 'disconnect');
    expect((await pay(sessionId, order.total, version, 'socket-payment')).status).toBe(201);
    await payment;
    await disconnected;
    const denied = event<Error>(guest, 'connect_error');
    guest.connect();
    expect((await denied).message).toBe('UNAUTHENTICATED');
  });

  it('rejects unavailable variants, unapproved toppings and AI recommendations outside constraints', async () => {
    const { cookie, payload } = await startVisit();
    const unrelated = await ToppingModel.create({
      name: 'Unapproved',
      price: 1000,
      isAvailable: true,
    });
    payload.items[0]!.toppingIds = [unrelated.id] as never[];
    expect(
      (
        await request(app)
          .post('/api/v1/orders')
          .set('Cookie', cookie)
          .set('Idempotency-Key', 'invalid-topping')
          .send(payload)
      ).status,
    ).toBe(422);
    payload.items[0]!.toppingIds = [];
    await ProductModel.updateOne({}, { $set: { 'variants.0.isAvailable': false } });
    expect(
      (
        await request(app)
          .post('/api/v1/orders')
          .set('Cookie', cookie)
          .set('Idempotency-Key', 'invalid-variant')
          .send(payload)
      ).status,
    ).toBe(422);
    const fallback = new AIService(null, 'fallback');
    expect(
      (await fallback.recommend({ prompt: 'không caffeine, dưới 50 nghìn' })).recommendations,
    ).toHaveLength(0);
    expect((await fallback.recommend({ prompt: 'dưới 10 nghìn' })).recommendations).toHaveLength(0);
    const recommendations = (await fallback.recommend({ prompt: 'vị đắng', maxBudget: 50000 }))
      .recommendations;
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]!.unitPrice).toBe(45000);
    expect(recommendations[0]!.variantId).toBeTruthy();
  });

  it('logs in, opens session, joins as guest, places and pays order', async () => {
    const openRes = await request(app)
      .post(`/api/v1/staff/tables/${tableId}/sessions`)
      .set('Authorization', `Bearer ${staffAccess}`);
    expect(openRes.status).toBe(200);

    const joinRes = await request(app).post('/api/v1/table-sessions/join').send({ tableToken });
    expect(joinRes.status).toBe(200);
    expect(joinRes.body.success).toBe(true);
    const cookie = joinRes.headers['set-cookie']?.[0]?.split(';')[0];
    expect(cookie).toBeDefined();
    const product = await ProductModel.findOne({ slug: 'espresso-may' });
    const variant = product!.variants[0]!;

    const placeRes = await request(app)
      .post('/api/v1/orders')
      .set('Cookie', cookie!)
      .set('Idempotency-Key', 'idem-key-1')
      .send({
        items: [
          {
            productId: product!._id.toString(),
            variantId: variant._id?.toString() ?? null,
            sugarLevel: '50%',
            iceLevel: 'normal-ice',
            toppingIds: [],
            quantity: 2,
          },
        ],
      });
    expect(placeRes.status).toBe(201);
    expect(placeRes.body.data.order.total).toBe(variant.price * 2);

    const orderId = placeRes.body.data.order._id as string;

    // idempotency
    const replay = await request(app)
      .post('/api/v1/orders')
      .set('Cookie', cookie!)
      .set('Idempotency-Key', 'idem-key-1')
      .send({
        items: [
          {
            productId: product!._id.toString(),
            variantId: variant._id?.toString() ?? null,
            sugarLevel: '50%',
            iceLevel: 'normal-ice',
            toppingIds: [],
            quantity: 2,
          },
        ],
      });
    expect(replay.status).toBe(200);
    expect(replay.body.data.created).toBe(false);

    // guest cannot cancel other guest's order
    const otherGuest = await request(app).post('/api/v1/table-sessions/join').send({ tableToken });
    const otherCookie = otherGuest.headers['set-cookie']?.[0]?.split(';')[0] ?? '';
    const otherCancel = await request(app)
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set('Cookie', otherCookie);
    expect(otherCancel.status).toBe(403);

    const confirmRes = await request(app)
      .patch(`/api/v1/staff/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${staffAccess}`)
      .send({ status: 'CONFIRMED' });
    expect(confirmRes.status).toBe(200);

    for (const status of ['PREPARING', 'READY', 'SERVED']) {
      const r = await request(app)
        .patch(`/api/v1/staff/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${staffAccess}`)
        .send({ status });
      expect(r.status).toBe(200);
    }

    const billRes = await request(app)
      .get(`/api/v1/staff/table-sessions/${confirmRes.body.data.order.tableSessionId}/bill`)
      .set('Authorization', `Bearer ${staffAccess}`);
    expect(billRes.status).toBe(200);
    expect(billRes.body.data.total).toBe(variant.price * 2);

    const expected = variant.price * 2;
    const sessionId = billRes.body.data.tableSessionId;
    // get current version
    const sessionsList = await request(app)
      .get('/api/v1/staff/table-sessions')
      .set('Authorization', `Bearer ${staffAccess}`);
    const current = sessionsList.body.data.items.find(
      (it: { session: { _id: string } }) => it.session._id === sessionId,
    );
    const version = current.session.version;
    const transitionRes = await request(app)
      .patch(`/api/v1/staff/table-sessions/${sessionId}/status`)
      .set('Authorization', `Bearer ${staffAccess}`)
      .send({ status: 'CHECKOUT', expectedVersion: version });
    const nextVersion =
      transitionRes.status === 200 ? transitionRes.body.data.session.version : version + 1;
    const payRes = await request(app)
      .post(`/api/v1/staff/table-sessions/${sessionId}/payments`)
      .set('Authorization', `Bearer ${staffAccess}`)
      .set('Idempotency-Key', 'pay-key-1')
      .send({ amount: expected, method: 'CASH', expectedVersion: nextVersion });
    expect(payRes.status).toBe(201);
    expect(payRes.body.data.payment.amount).toBe(expected);
  }, 60_000);

  it('server recomputes unitPrice from menu (ignores client price)', async () => {
    await request(app)
      .post(`/api/v1/staff/tables/${tableId}/sessions`)
      .set('Authorization', `Bearer ${staffAccess}`);
    const joinRes = await request(app).post('/api/v1/table-sessions/join').send({ tableToken });
    const cookie = joinRes.headers['set-cookie']?.[0]?.split(';')[0] ?? '';
    const product = await ProductModel.findOne({ slug: 'espresso-may' });
    const variant = product!.variants[0]!;
    const res = await request(app)
      .post('/api/v1/orders')
      .set('Cookie', cookie)
      .set('Idempotency-Key', 'idem-key-2')
      .send({
        items: [
          {
            productId: product!._id.toString(),
            variantId: variant._id?.toString() ?? null,
            sugarLevel: '100%',
            iceLevel: 'normal-ice',
            toppingIds: [],
            quantity: 1,
            unitPrice: 1,
            lineTotal: 1,
          },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.data.order.total).toBe(variant.price);
  }, 60_000);

  it('rejects order with invalid variantId', async () => {
    await request(app)
      .post(`/api/v1/staff/tables/${tableId}/sessions`)
      .set('Authorization', `Bearer ${staffAccess}`);
    const joinRes = await request(app).post('/api/v1/table-sessions/join').send({ tableToken });
    const cookie = joinRes.headers['set-cookie']?.[0]?.split(';')[0] ?? '';
    const product = await ProductModel.findOne({ slug: 'espresso-may' });
    const res = await request(app)
      .post('/api/v1/orders')
      .set('Cookie', cookie)
      .set('Idempotency-Key', 'idem-key-3')
      .send({
        items: [
          {
            productId: product!._id.toString(),
            variantId: '6f0e0000000000000000abcd',
            sugarLevel: '100%',
            iceLevel: 'normal-ice',
            toppingIds: [],
            quantity: 1,
          },
        ],
      });
    expect(res.status).toBe(422);
  }, 60_000);

  it('returns idempotent result when same key is reused with same payload', async () => {
    await request(app)
      .post(`/api/v1/staff/tables/${tableId}/sessions`)
      .set('Authorization', `Bearer ${staffAccess}`);
    const joinRes = await request(app).post('/api/v1/table-sessions/join').send({ tableToken });
    const cookie = joinRes.headers['set-cookie']?.[0]?.split(';')[0] ?? '';
    const product = await ProductModel.findOne({ slug: 'espresso-may' });
    const variant = product!.variants[0]!;
    const payload = {
      items: [
        {
          productId: product!._id.toString(),
          variantId: variant._id?.toString() ?? null,
          sugarLevel: '50%',
          iceLevel: 'normal-ice',
          toppingIds: [],
          quantity: 1,
        },
      ],
    };
    const r1 = await request(app)
      .post('/api/v1/orders')
      .set('Cookie', cookie)
      .set('Idempotency-Key', 'idem-dup')
      .send(payload);
    const r2 = await request(app)
      .post('/api/v1/orders')
      .set('Cookie', cookie)
      .set('Idempotency-Key', 'idem-dup')
      .send(payload);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(200);
    expect(r1.body.data.order._id).toBe(r2.body.data.order._id);
  }, 60_000);

  it('rejects duplicate idempotency key with different payload', async () => {
    await request(app)
      .post(`/api/v1/staff/tables/${tableId}/sessions`)
      .set('Authorization', `Bearer ${staffAccess}`);
    const joinRes = await request(app).post('/api/v1/table-sessions/join').send({ tableToken });
    const cookie = joinRes.headers['set-cookie']?.[0]?.split(';')[0] ?? '';
    const product = await ProductModel.findOne({ slug: 'espresso-may' });
    const variant = product!.variants[0]!;
    await request(app)
      .post('/api/v1/orders')
      .set('Cookie', cookie)
      .set('Idempotency-Key', 'idem-conflict')
      .send({
        items: [
          {
            productId: product!._id.toString(),
            variantId: variant._id?.toString() ?? null,
            sugarLevel: '50%',
            iceLevel: 'normal-ice',
            toppingIds: [],
            quantity: 1,
          },
        ],
      });
    const conflict = await request(app)
      .post('/api/v1/orders')
      .set('Cookie', cookie)
      .set('Idempotency-Key', 'idem-conflict')
      .send({
        items: [
          {
            productId: product!._id.toString(),
            variantId: variant._id?.toString() ?? null,
            sugarLevel: '100%',
            iceLevel: 'normal-ice',
            toppingIds: [],
            quantity: 5,
          },
        ],
      });
    expect(conflict.status).toBe(409);
  }, 60_000);

  describe('guest auto-open sessions', () => {
    function cookieNamed(res: { headers: Record<string, unknown> }, name: string): string {
      const header = res.headers['set-cookie'];
      const raw = (Array.isArray(header) ? (header as string[]) : []).find((c: string) =>
        c.startsWith(`${name}=`),
      );
      expect(raw).toBeDefined();
      return raw!.split(';')[0]!;
    }
    async function orderPayload() {
      const product = (await ProductModel.findOne({ slug: 'espresso-may' }))!;
      return {
        items: [
          {
            productId: product._id.toString(),
            variantId: product.variants[0]!._id!.toString(),
            sugarLevel: '50%',
            iceLevel: 'normal-ice',
            toppingIds: [],
            quantity: 1,
          },
        ],
      };
    }
    async function joinWithoutStaff(cookie?: string) {
      const req = request(app).post('/api/v1/table-sessions/join');
      if (cookie) req.set('Cookie', cookie);
      const res = await req.send({ tableToken });
      expect(res.status).toBe(200);
      return res;
    }

    it('auto-opens a GUEST session so a fresh table can order without staff', async () => {
      const joined = await joinWithoutStaff();
      expect(joined.body.data.created).toBe(true);
      expect(joined.body.data.table).toMatchObject({
        id: tableId,
        code: 'B01',
        name: 'Bàn 01',
        capacity: 4,
      });
      const cookie = cookieNamed(joined, 'mc_guest');
      const sessionId = joined.body.data.tableSessionId as string;
      expect(joined.body.data.tableSession).toMatchObject({ id: sessionId, status: 'OPEN' });

      const sessions = await TableSessionModel.find({ tableId }).lean();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({ status: 'OPEN', source: 'GUEST', openedBy: null });
      expect(sessions[0]!._id.toString()).toBe(sessionId);
      expect(
        await AuditLogModel.countDocuments({
          action: 'tableSession.autoOpened',
          entityId: sessionId,
        }),
      ).toBe(1);

      const order = await place(cookie, await orderPayload());
      expect(order.total).toBe(35000);
    }, 60_000);

    it('reuses the same participant and session when the QR is scanned again', async () => {
      const first = await joinWithoutStaff();
      const cookie = cookieNamed(first, 'mc_guest');
      const again = await joinWithoutStaff(cookie);
      expect(again.body.data.created).toBe(false);
      expect(again.body.data.participantId).toBe(first.body.data.participantId);
      expect(again.body.data.tableSessionId).toBe(first.body.data.tableSessionId);
      expect(await TableSessionModel.countDocuments({ tableId })).toBe(1);
    }, 60_000);

    it('returns the live GUEST session instead of a conflict when staff opens the table', async () => {
      const joined = await joinWithoutStaff();
      const sessionId = joined.body.data.tableSessionId as string;
      const opened = await request(app)
        .post(`/api/v1/staff/tables/${tableId}/sessions`)
        .set('Authorization', `Bearer ${staffAccess}`);
      expect(opened.status).toBe(200);
      expect(opened.body.data.created).toBe(false);
      expect(opened.body.data.session._id).toBe(sessionId);

      const list = await request(app)
        .get('/api/v1/staff/table-sessions')
        .set('Authorization', `Bearer ${staffAccess}`);
      expect(list.status).toBe(200);
      const item = list.body.data.items.find(
        (it: { session: { _id: string } }) => it.session._id === sessionId,
      );
      expect(item).toBeDefined();
      expect(item.session.source).toBe('GUEST');
      expect(item.session).toHaveProperty('closedReason');
      expect(item.table._id).toBe(tableId);
    }, 60_000);

    it('bill closes the auto-opened session and lets a new scan order again', async () => {
      const joined = await joinWithoutStaff();
      const cookie = cookieNamed(joined, 'mc_guest');
      const sessionId = joined.body.data.tableSessionId as string;
      const order = await place(cookie, await orderPayload());
      await serve(order._id);
      const version = await checkout(sessionId);
      const paid = await pay(sessionId, order.total, version, 'auto-open-payment');
      expect(paid.status).toBe(201);
      expect(typeof paid.body.data.billId).toBe('string');
      expect(paid.body.data.orderIds).toEqual([order._id]);
      expect((await TableSessionModel.findById(sessionId))!.status).toBe('CLOSED');

      const rescan = await joinWithoutStaff(cookie);
      expect(rescan.body.data.created).toBe(true);
      const newSessionId = rescan.body.data.tableSessionId as string;
      expect(newSessionId).not.toBe(sessionId);
      expect((await TableSessionModel.findById(newSessionId))!.status).toBe('OPEN');

      const newCookie = cookieNamed(rescan, 'mc_guest');
      const newOrder = await place(newCookie, await orderPayload());
      expect(newOrder._id).toBeTruthy();

      const revoked = await request(app)
        .post('/api/v1/orders')
        .set('Cookie', cookie)
        .set('Idempotency-Key', randomToken(16))
        .send(await orderPayload());
      expect(revoked.status).toBe(401);
    }, 60_000);

    it('replays the payment idempotently against a single immutable bill', async () => {
      const joined = await joinWithoutStaff();
      const cookie = cookieNamed(joined, 'mc_guest');
      const sessionId = joined.body.data.tableSessionId as string;
      const order = await place(cookie, await orderPayload());
      await serve(order._id);
      const version = await checkout(sessionId);

      const metricBefore = getInstanceMetricsSnapshot().businessEvents.payment_confirmed;
      const first = await pay(sessionId, order.total, version, 'auto-open-replay');
      expect(first.status).toBe(201);
      expect(getInstanceMetricsSnapshot().businessEvents.payment_confirmed).toBe(metricBefore + 1);
      const replay = await pay(sessionId, order.total, version, 'auto-open-replay');
      expect(replay.status).toBe(200);
      expect(replay.body.data.replayed).toBe(true);
      expect(getInstanceMetricsSnapshot().businessEvents.payment_confirmed).toBe(metricBefore + 1);
      expect(replay.body.data.billId).toBe(first.body.data.billId);
      expect(await BillModel.countDocuments({ tableSessionId: sessionId })).toBe(1);
      expect(await PaymentModel.countDocuments({ tableSessionId: sessionId })).toBe(1);
    }, 60_000);

    it('serves the frozen bill snapshot and a receipt free of internal fields', async () => {
      const joined = await joinWithoutStaff();
      const cookie = cookieNamed(joined, 'mc_guest');
      const receiptCookie = cookieNamed(joined, 'mc_receipt');
      const sessionId = joined.body.data.tableSessionId as string;
      const order = await place(cookie, await orderPayload());
      await serve(order._id);
      const version = await checkout(sessionId);
      expect((await pay(sessionId, order.total, version, 'auto-open-snapshot')).status).toBe(201);

      const receipt = await request(app)
        .get('/api/v1/receipts/current')
        .set('Cookie', receiptCookie);
      expect(receipt.status).toBe(200);
      expect(receipt.body.data.orders).toHaveLength(1);
      const line = receipt.body.data.orders[0];
      expect(line).toMatchObject({
        _id: order._id,
        code: expect.any(String),
        total: order.total,
        review: null,
      });
      expect(line.items).toHaveLength(1);
      for (const item of [line, ...line.items]) {
        for (const key of ['idempotencyKey', 'requestHash', 'statusHistory', 'version', '__v']) {
          expect(item).not.toHaveProperty(key);
        }
      }

      await OrderModel.updateOne({ _id: order._id }, { $set: { total: 1 } });
      const bill = await request(app)
        .get(`/api/v1/staff/table-sessions/${sessionId}/bill`)
        .set('Authorization', `Bearer ${staffAccess}`);
      expect(bill.status).toBe(200);
      expect(bill.body.data.total).toBe(order.total);
      expect(bill.body.data.orders).toHaveLength(1);
      expect(bill.body.data.orders[0]._id).toBe(order._id);
      expect(bill.body.data.orders[0].total).toBe(order.total);
    }, 60_000);

    it('refuses guests when auto-open is disabled', async () => {
      // `config` là object runtime thường; chỉ tầng type mới là `as const` nên test đổi được giá trị.
      const runtimeConfig = config as unknown as { guestAutoOpen: boolean };
      const previous = runtimeConfig.guestAutoOpen;
      runtimeConfig.guestAutoOpen = false;
      try {
        const res = await request(app).post('/api/v1/table-sessions/join').send({ tableToken });
        expect(res.status).toBe(403);
        expect(res.body.error).toMatchObject({
          code: 'FORBIDDEN',
          message: 'Bàn chưa mở phiên phục vụ, vui lòng báo nhân viên.',
        });
        expect(await TableSessionModel.countDocuments()).toBe(0);
      } finally {
        runtimeConfig.guestAutoOpen = previous;
      }
    }, 60_000);
  });
});
