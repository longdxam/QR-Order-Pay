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
  await Promise.all(Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})));
  await Promise.all([
    UserModel.deleteMany({}),
    TableModel.deleteMany({}),
    CategoryModel.deleteMany({}),
    ProductModel.deleteMany({}),
    ToppingModel.deleteMany({}),
  ]);
  const passwordHash = await hashPassword('Password@123');
  await UserModel.create({ name: 'Admin', email: 'admin@test.vn', passwordHash, role: 'ADMIN', isActive: true });
  await UserModel.create({ name: 'Staff', email: 'staff@test.vn', passwordHash, role: 'STAFF', isActive: true });
  const cat = await CategoryModel.create({ name: 'Cà phê', slug: 'cafe', sortOrder: 0, isActive: true });
  const topping = await ToppingModel.create({ name: 'Trân châu đen', price: 8000, isAvailable: true, isArchived: false });
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

afterEach(() => { for (const socket of clients.splice(0)) socket.disconnect(); });

beforeEach(async () => {
  await seedBasic();
  const loginRes = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'staff@test.vn', password: 'Password@123' });
  staffAccess = loginRes.body.data.accessToken;
});

describe('order flow integration', () => {
  it('lists review statistics for admins only and applies rating/date filters', async () => {
    await ReviewModel.create([
      { orderId: new mongoose.Types.ObjectId(), tableSessionId: new mongoose.Types.ObjectId(), participantId: 'guest-1', rating: 5, comment: 'Rất ngon' },
      { orderId: new mongoose.Types.ObjectId(), tableSessionId: new mongoose.Types.ObjectId(), participantId: 'guest-2', rating: 3, comment: 'Ổn' },
    ]);
    const adminLogin = await request(app).post('/api/v1/auth/login').send({ email: 'admin@test.vn', password: 'Password@123' });
    const adminAccess = adminLogin.body.data.accessToken as string;
    const all = await request(app).get('/api/v1/admin/reviews').set('Authorization', `Bearer ${adminAccess}`);
    expect(all.status).toBe(200);
    expect(all.body.data).toMatchObject({ total: 2, averageRating: 4 });
    expect(all.body.data.distribution.find((item: { rating: number }) => item.rating === 5).count).toBe(1);
    const filtered = await request(app).get('/api/v1/admin/reviews?rating=5').set('Authorization', `Bearer ${adminAccess}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.data).toMatchObject({ total: 1, averageRating: 5 });
    expect((await request(app).get('/api/v1/admin/reviews').set('Authorization', `Bearer ${staffAccess}`)).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/reviews?rating=9').set('Authorization', `Bearer ${adminAccess}`)).status).toBe(422);
  });

  function cookies(res: { headers: Record<string, unknown> }): string {
    return (res.headers['set-cookie'] as string[]).map((c) => c.split(';')[0]).join('; ');
  }
  async function startVisit() {
    const opened = await request(app).post(`/api/v1/staff/tables/${tableId}/sessions`).set('Authorization', `Bearer ${staffAccess}`);
    expect(opened.status).toBe(200);
    const joined = await request(app).post('/api/v1/table-sessions/join').send({ tableToken });
    expect(joined.status).toBe(200);
    const product = (await ProductModel.findOne())!;
    const payload = { items: [{ productId: product.id, variantId: product.variants[0]!._id!.toString(), sugarLevel: '50%', iceLevel: 'normal-ice', toppingIds: [], quantity: 1 }] };
    return { cookie: cookies(joined), sessionId: opened.body.data.session._id as string, payload, participantId: joined.body.data.participantId as string };
  }
  async function place(cookie: string, payload: object, key = randomToken(16)) {
    const res = await request(app).post('/api/v1/orders').set('Cookie', cookie).set('Idempotency-Key', key).send(payload);
    expect(res.status).toBe(201);
    return res.body.data.order as { _id: string; total: number };
  }
  async function serve(id: string) {
    for (const status of ['CONFIRMED', 'PREPARING', 'READY', 'SERVED']) {
      const res = await request(app).patch(`/api/v1/staff/orders/${id}/status`).set('Authorization', `Bearer ${staffAccess}`).send({ status });
      expect(res.status).toBe(200);
    }
  }
  async function checkout(sessionId: string) {
    const session = (await TableSessionModel.findById(sessionId))!;
    const res = await request(app).patch(`/api/v1/staff/table-sessions/${sessionId}/status`).set('Authorization', `Bearer ${staffAccess}`).send({ status: 'CHECKOUT', expectedVersion: session.version });
    expect(res.status).toBe(200);
    return res.body.data.session.version as number;
  }
  function pay(sessionId: string, amount: number, version: number, key: string) {
    return request(app).post(`/api/v1/staff/table-sessions/${sessionId}/payments`).set('Authorization', `Bearer ${staffAccess}`).set('Idempotency-Key', key).send({ amount, expectedVersion: version, method: 'CASH' });
  }
  function event<T = unknown>(socket: Socket, name: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { socket.off(name, handler); reject(new Error(`Timeout: ${name}`)); }, 5000);
      const handler = (data: T) => { clearTimeout(timeout); resolve(data); };
      socket.once(name, handler);
    });
  }
  async function guestSocket(cookie: string): Promise<Socket> {
    const socket = connectSocket(socketUrl, { autoConnect: false, transports: ['websocket'], extraHeaders: { Cookie: cookie }, auth: { role: 'GUEST' }, reconnection: false });
    clients.push(socket);
    const connected = event(socket, 'connect');
    socket.connect();
    await connected;
    return socket;
  }

  it('completes two-guest payment, receipt and review flow without reopening ordering rights', async () => {
    const { cookie, sessionId, payload, participantId } = await startVisit();
    const tables = await request(app).get('/api/v1/staff/tables').set('Authorization', `Bearer ${staffAccess}`);
    expect(tables.status).toBe(200);
    expect(tables.body.data.tables[0]).not.toHaveProperty('publicTokenHash');
    expect((await request(app).get('/api/v1/admin/tables').set('Authorization', `Bearer ${staffAccess}`)).status).toBe(403);
    const current = await request(app).get('/api/v1/table-sessions/current').set('Cookie', cookie);
    expect(current.body.data.table.name).toBe('Bàn 01');
    const rejoin = await request(app).post('/api/v1/table-sessions/join').set('Cookie', cookie).send({ tableToken });
    expect(rejoin.body.data.participantId).toBe(participantId);
    const second = await request(app).post('/api/v1/table-sessions/join').send({ tableToken });
    const secondCookie = cookies(second);
    const firstOrder = await place(cookie, payload);
    const secondOrder = await place(secondCookie, payload);
    expect((await request(app).get('/api/v1/receipts/current').set('Cookie', cookie)).status).toBe(401);
    await serve(firstOrder._id);
    await serve(secondOrder._id);
    expect((await request(app).post(`/api/v1/orders/${firstOrder._id}/review`).set('Cookie', cookie).send({ rating: 5 })).status).toBe(422);
    await request(app).post('/api/v1/service-requests').set('Cookie', cookie).send({ type: 'REQUEST_BILL' });
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
    expect(await GuestSessionModel.countDocuments({ tableSessionId: sessionId, revokedAt: null })).toBe(0);
    expect((await request(app).post('/api/v1/orders').set('Cookie', cookie).set('Idempotency-Key', 'old-guest-order').send(payload)).status).toBe(401);
    const receipt = await request(app).get('/api/v1/receipts/current').set('Cookie', cookie);
    expect(receipt.status).toBe(200);
    expect(receipt.body.data.orders.map((o: { _id: string }) => o._id)).toEqual([firstOrder._id]);
    expect(receipt.body.data.total).toBe(firstOrder.total);
    expect((await request(app).post(`/api/v1/receipts/orders/${secondOrder._id}/review`).set('Cookie', cookie).send({ rating: 5 })).status).toBe(403);
    const review = await request(app).post(`/api/v1/receipts/orders/${firstOrder._id}/review`).set('Cookie', cookie).send({ rating: 5, comment: 'Ngon!' });
    expect(review.status).toBe(201);
    expect((await request(app).post(`/api/v1/receipts/orders/${firstOrder._id}/review`).set('Cookie', cookie).send({ rating: 4 })).status).toBe(409);
    expect((await request(app).get('/api/v1/receipts/current').set('Cookie', cookie)).body.data.orders[0].review.rating).toBe(5);
    expect((await request(app).get('/api/v1/table-sessions/current').set('Cookie', cookie)).body.data).toMatchObject({ active: false, receiptAvailable: true });
    const requests = await request(app).get('/api/v1/staff/service-requests').set('Authorization', `Bearer ${staffAccess}`);
    expect(requests.body.data.items).toHaveLength(0);
    await GuestSessionModel.updateMany({ tableSessionId: sessionId }, { expiresAt: new Date(0) });
    expect((await request(app).get('/api/v1/receipts/current').set('Cookie', cookie)).status).toBe(401);
  });

  it('prevents closing unpaid sessions, paying unfinished orders and ordering during checkout', async () => {
    const { cookie, sessionId, payload } = await startVisit();
    const order = await place(cookie, payload);
    const current = (await TableSessionModel.findById(sessionId))!;
    const close = await request(app).patch(`/api/v1/staff/table-sessions/${sessionId}/status`).set('Authorization', `Bearer ${staffAccess}`).send({ status: 'CLOSED', expectedVersion: current.version });
    expect(close.status).toBe(403);
    expect((await TableSessionModel.findById(sessionId))!.status).toBe('OPEN');
    expect((await pay(sessionId, order.total, current.version, 'pay-before-checkout')).status).toBe(403);
    const version = await checkout(sessionId);
    expect((await pay(sessionId, order.total, version, 'pay-unfinished')).status).toBe(422);
    expect((await request(app).post('/api/v1/orders').set('Cookie', cookie).set('Idempotency-Key', 'checkout-order').send(payload)).status).toBe(403);
  });

  it('closes an empty table, invalidates receipt access on leave and opens a fresh visit', async () => {
    const { cookie, sessionId } = await startVisit();
    await request(app).post('/api/v1/service-requests').set('Cookie', cookie).send({ type: 'CALL_STAFF' });
    const closed = await request(app).patch(`/api/v1/staff/table-sessions/${sessionId}/status`).set('Authorization', `Bearer ${staffAccess}`).send({ status: 'CLOSED', expectedVersion: 0 });
    expect(closed.status).toBe(200);
    expect((await request(app).get('/api/v1/receipts/current').set('Cookie', cookie)).status).toBe(200);
    expect((await request(app).post('/api/v1/table-sessions/leave').set('Cookie', cookie)).status).toBe(200);
    expect((await request(app).get('/api/v1/receipts/current').set('Cookie', cookie)).status).toBe(401);
    const next = await startVisit();
    expect(next.sessionId).not.toBe(sessionId);
    expect((await request(app).get('/api/v1/table-sessions/current').set('Cookie', cookie)).body.data.active).toBe(false);
  });

  it('authenticates realtime with HttpOnly cookies and publishes through the full order lifecycle', async () => {
    const { cookie, sessionId, payload, participantId } = await startVisit();
    const guest = await guestSocket(cookie);
    const serverGuest = socketServer.sockets.sockets.get(guest.id!)!;
    expect(serverGuest.rooms.has(`guest:${sessionId}:${participantId}`)).toBe(true);
    expect(serverGuest.rooms.has('staff')).toBe(false);
    const staff = connectSocket(socketUrl, { autoConnect: false, transports: ['websocket'], auth: { role: 'STAFF', accessToken: staffAccess }, reconnection: false });
    clients.push(staff);
    const connected = event(staff, 'connect'); staff.connect(); await connected;
    const created = event<{ orderId: string }>(staff, 'order.created');
    const order = await place(cookie, payload);
    expect((await created).orderId).toBe(order._id);
    const changed = event<{ status: string }>(guest, 'order.statusChanged');
    await serve(order._id);
    expect((await changed).status).toBe('CONFIRMED');
    const requested = event(staff, 'serviceRequest.created');
    await request(app).post('/api/v1/service-requests').set('Cookie', cookie).send({ type: 'CALL_STAFF' });
    await requested;
    const version = await checkout(sessionId);
    const payment = event(guest, 'payment.confirmed');
    const disconnected = event(guest, 'disconnect');
    expect((await pay(sessionId, order.total, version, 'socket-payment')).status).toBe(201);
    await payment; await disconnected;
    const denied = event<Error>(guest, 'connect_error'); guest.connect();
    expect((await denied).message).toBe('UNAUTHENTICATED');
  });

  it('rejects unavailable variants, unapproved toppings and AI recommendations outside constraints', async () => {
    const { cookie, payload } = await startVisit();
    const unrelated = await ToppingModel.create({ name: 'Unapproved', price: 1000, isAvailable: true });
    payload.items[0]!.toppingIds = [unrelated.id] as never[];
    expect((await request(app).post('/api/v1/orders').set('Cookie', cookie).set('Idempotency-Key', 'invalid-topping').send(payload)).status).toBe(422);
    payload.items[0]!.toppingIds = [];
    await ProductModel.updateOne({}, { $set: { 'variants.0.isAvailable': false } });
    expect((await request(app).post('/api/v1/orders').set('Cookie', cookie).set('Idempotency-Key', 'invalid-variant').send(payload)).status).toBe(422);
    const fallback = new AIService(null, 'fallback');
    expect((await fallback.recommend({ prompt: 'không caffeine, dưới 50 nghìn' })).recommendations).toHaveLength(0);
    expect((await fallback.recommend({ prompt: 'dưới 10 nghìn' })).recommendations).toHaveLength(0);
    const recommendations = (await fallback.recommend({ prompt: 'vị đắng', maxBudget: 50000 })).recommendations;
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]!.unitPrice).toBe(45000);
    expect(recommendations[0]!.variantId).toBeTruthy();
  });

  it('logs in, opens session, joins as guest, places and pays order', async () => {
    const openRes = await request(app)
      .post(`/api/v1/staff/tables/${tableId}/sessions`)
      .set('Authorization', `Bearer ${staffAccess}`);
    expect(openRes.status).toBe(200);

    const joinRes = await request(app)
      .post('/api/v1/table-sessions/join')
      .send({ tableToken });
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
    const otherGuest = await request(app)
      .post('/api/v1/table-sessions/join')
      .send({ tableToken });
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
      .get(`/api/v1/staff/table-sessions/${(confirmRes.body.data.order.tableSessionId)}/bill`)
      .set('Authorization', `Bearer ${staffAccess}`);
    expect(billRes.status).toBe(200);
    expect(billRes.body.data.total).toBe(variant.price * 2);

    const expected = variant.price * 2;
    const sessionId = billRes.body.data.tableSessionId;
    // get current version
    const sessionsList = await request(app)
      .get('/api/v1/staff/table-sessions')
      .set('Authorization', `Bearer ${staffAccess}`);
    const current = sessionsList.body.data.items.find((it: { session: { _id: string } }) => it.session._id === sessionId);
    const version = current.session.version;
    const transitionRes = await request(app)
      .patch(`/api/v1/staff/table-sessions/${sessionId}/status`)
      .set('Authorization', `Bearer ${staffAccess}`)
      .send({ status: 'CHECKOUT', expectedVersion: version });
    const nextVersion = transitionRes.status === 200 ? transitionRes.body.data.session.version : version + 1;
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
    const r1 = await request(app).post('/api/v1/orders').set('Cookie', cookie).set('Idempotency-Key', 'idem-dup').send(payload);
    const r2 = await request(app).post('/api/v1/orders').set('Cookie', cookie).set('Idempotency-Key', 'idem-dup').send(payload);
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
});
