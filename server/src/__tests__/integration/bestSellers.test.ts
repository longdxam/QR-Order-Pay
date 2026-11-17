import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { buildApp } from '../../app.js';
import { CategoryModel } from '../../models/Category.js';
import { ProductModel } from '../../models/Product.js';
import { OrderModel } from '../../models/Order.js';
import { UserModel } from '../../models/User.js';
import { priceOrderItems } from '../../services/orderPricingService.js';
import { hashPassword } from '../../utils/crypto.js';

let repl: MongoMemoryReplSet;
let app: ReturnType<typeof buildApp>;
let admin: Record<string, string>;
let categoryId: string;
let seq = 0;
const freshId = () => new mongoose.Types.ObjectId();

async function product(name: string, sortOrder: number, extra: Record<string, unknown> = {}) {
  return ProductModel.create({
    categoryId,
    name,
    slug: `${name.toLowerCase().replace(/\s+/g, '-')}-${sortOrder}`,
    image: '/menu-images/test.webp',
    basePrice: 30000,
    sortOrder,
    allowedOptions: { sizes: [], sugarLevels: ['50%'], iceLevels: ['normal-ice'], toppingIds: [] },
    ...extra,
  });
}

async function sell(
  productId: string,
  quantity: number,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const priced = await priceOrderItems([
    {
      productId,
      variantId: null,
      sugarLevel: '50%',
      iceLevel: 'normal-ice',
      toppingIds: [],
      quantity,
    },
  ]);
  seq += 1;
  await OrderModel.create({
    code: `BS${seq}`,
    tableSessionId: freshId(),
    tableId: freshId(),
    participantId: 'guest',
    status: 'SERVED',
    paymentStatus: 'PAID',
    paidAmount: priced.total,
    total: priced.total,
    idempotencyKey: `bs-key-${seq}`,
    requestHash: `bs-hash-${seq}`,
    items: priced.items,
    ...extra,
  });
}

const best = async (limit?: number) =>
  (await request(app).get(`/api/v1/products/best-sellers${limit ? `?limit=${limit}` : ''}`)).body
    .data.productIds as string[];

beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(repl.getUri());
  app = buildApp();
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  await UserModel.create({
    name: 'Admin',
    email: 'admin@test.vn',
    role: 'ADMIN',
    isActive: true,
    passwordHash: await hashPassword('Password@123'),
  });
  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'admin@test.vn', password: 'Password@123' });
  admin = { Authorization: `Bearer ${login.body.data.accessToken}` };
}, 120000);
beforeEach(async () => {
  await Promise.all(
    [CategoryModel, ProductModel, OrderModel].map((model) => model.collection.deleteMany({})),
  );
  categoryId = (await CategoryModel.create({ name: 'Trà', slug: 'tra' })).id;
});
afterAll(async () => {
  await mongoose.disconnect();
  await repl.stop();
});

describe('món bán chạy', () => {
  it('xếp theo số lượng đã trả tiền, bỏ đơn hủy, chưa trả và quá 90 ngày, rồi bổ sung theo thực đơn', async () => {
    const a = await product('Trà A', 3);
    const b = await product('Trà B', 2);
    const c = await product('Trà C', 1);
    const d = await product('Trà D', 0);
    await sell(a.id, 3);
    await sell(a.id, 2); // A: 5
    await sell(b.id, 2); // B: 2
    await sell(c.id, 9, { status: 'CANCELLED' });
    await sell(c.id, 9, { paymentStatus: 'UNPAID', status: 'AWAITING_PAYMENT', paidAmount: 0 });
    // Ngoài kỳ mặc định 30 ngày của Dashboard thì không tính.
    await sell(c.id, 9, { createdAt: new Date(Date.now() - 40 * 86_400_000) });

    expect(await best()).toEqual([a.id, b.id, d.id, c.id]);
    expect(await best(2)).toEqual([a.id, b.id]);
  });

  it('trùng thứ tự với "Top sản phẩm" của Dashboard ở kỳ mặc định, kể cả khi bằng số lượng', async () => {
    const products = await Promise.all(
      ['Một', 'Hai', 'Ba', 'Bốn', 'Năm', 'Sáu', 'Bảy'].map((name, i) => product(`Trà ${name}`, i)),
    );
    const sold = [4, 7, 2, 2, 5, 1, 2];
    for (const [i, p] of products.entries()) await sell(p.id, sold[i]!);

    const dashboard = await request(app).get('/api/v1/admin/reports/overview').set(admin);
    expect(dashboard.status).toBe(200);
    const top = (dashboard.body.data.topProducts as Array<{ productId: string }>).map(
      (row) => row.productId,
    );
    expect(top).toHaveLength(5);
    expect((await best()).slice(0, 5)).toEqual(top);
  });

  it('chỉ trả món còn bán và không nhận limit vô lý', async () => {
    const a = await product('Trà A', 1);
    const archived = await product('Trà Lưu Trữ', 2);
    const paused = await product('Trà Tạm Ngừng', 3);
    await sell(archived.id, 50);
    await sell(paused.id, 40);
    await sell(a.id, 1);
    // Món đã bán nhiều nhưng sau đó bị lưu trữ / tạm ngừng thì không được lên danh sách.
    await ProductModel.updateOne({ _id: archived._id }, { $set: { isArchived: true } });
    await ProductModel.updateOne({ _id: paused._id }, { $set: { isAvailable: false } });

    expect(await best()).toEqual([a.id]);
    expect(await best(0)).toHaveLength(1);
    const huge = await request(app).get('/api/v1/products/best-sellers?limit=999');
    expect(huge.status).toBe(200);
    expect(huge.body.data.productIds).toEqual([a.id]);
  });
});
