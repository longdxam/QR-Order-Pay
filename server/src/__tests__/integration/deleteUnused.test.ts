import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { buildApp } from '../../app.js';
import { UserModel } from '../../models/User.js';
import { CategoryModel } from '../../models/Category.js';
import { ProductModel } from '../../models/Product.js';
import { IngredientModel } from '../../models/Ingredient.js';
import { RecipeModel } from '../../models/Recipe.js';
import { StockMovementModel } from '../../models/StockMovement.js';
import { VoucherModel, VoucherUseModel } from '../../models/Voucher.js';
import { AuditLogModel } from '../../models/AuditLog.js';
import { hashPassword } from '../../utils/crypto.js';

let repl: MongoMemoryReplSet;
let app: ReturnType<typeof buildApp>;
let admin: Record<string, string>;
let staff: Record<string, string>;
const base = '/api/v1/admin/inventory';

async function signIn(email: string, role: 'ADMIN' | 'STAFF') {
  await UserModel.create({
    name: role,
    email,
    role,
    isActive: true,
    passwordHash: await hashPassword('Password@123'),
  });
  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password: 'Password@123' });
  return { Authorization: `Bearer ${login.body.data.accessToken}` };
}
const newIngredient = async (name: string) =>
  (await request(app).post(`${base}/ingredients`).set(admin).send({ name })).body.data
    .ingredient as { id: string; version: number };
const deleteIngredient = (id: string, who = admin) =>
  request(app).delete(`${base}/ingredients/${id}`).set(who);
const newVoucher = async (code: string) =>
  (
    await request(app)
      .post('/api/v1/admin/vouchers')
      .set(admin)
      .send({
        code,
        name: 'Thử xóa',
        type: 'FIXED',
        value: 10000,
        minSubtotal: 0,
        maxDiscount: null,
        startsAt: new Date(Date.now() - 60000).toISOString(),
        endsAt: new Date(Date.now() + 86400000).toISOString(),
        maxUses: 10,
        perMemberLimit: null,
        memberRequired: false,
        isActive: true,
      })
  ).body.data.voucher as { id: string };

beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(repl.getUri());
  app = buildApp();
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  admin = await signIn('admin@test.vn', 'ADMIN');
  staff = await signIn('staff@test.vn', 'STAFF');
}, 120000);
beforeEach(async () => {
  await Promise.all(
    [
      IngredientModel,
      RecipeModel,
      StockMovementModel,
      VoucherModel,
      VoucherUseModel,
      CategoryModel,
      ProductModel,
      AuditLogModel,
    ].map((model) => model.collection.deleteMany({})),
  );
});
afterAll(async () => {
  await mongoose.disconnect();
  await repl.stop();
});

describe('xóa nguyên liệu chưa dùng', () => {
  it('xóa nguyên liệu mới tạo, có audit; nhân viên không xóa được', async () => {
    const item = await newIngredient('Bột thử');
    expect((await deleteIngredient(item.id, staff)).status).toBe(403);
    expect((await deleteIngredient(item.id)).status).toBe(200);
    expect(await IngredientModel.exists({ _id: item.id })).toBeNull();
    expect(
      await AuditLogModel.exists({ action: 'inventory.ingredientDeleted', entityId: item.id }),
    ).toBeTruthy();
    expect((await deleteIngredient(item.id)).status).toBe(404);
  });

  it('không xóa nguyên liệu đã có biến động kho, kể cả khi tồn đã về 0', async () => {
    const item = await newIngredient('Sữa thử');
    const move = (type: 'RECEIPT' | 'ISSUE', expectedVersion: number) =>
      request(app)
        .post(`${base}/ingredients/${item.id}/movements`)
        .set(admin)
        .send({ type, quantity: 5, reason: 'Thử', expectedVersion, idempotencyKey: randomUUID() });
    expect((await move('RECEIPT', item.version)).status).toBe(200);
    expect((await move('ISSUE', item.version + 1)).status).toBe(200);
    expect((await IngredientModel.findById(item.id))?.onHand).toBe(0);
    const res = await deleteIngredient(item.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INGREDIENT_IN_USE');
    expect(await IngredientModel.exists({ _id: item.id })).toBeTruthy();
  });

  it('không xóa nguyên liệu đang nằm trong công thức', async () => {
    const item = await newIngredient('Đường thử');
    const category = await CategoryModel.create({ name: 'Trà', slug: 'tra' });
    const product = await ProductModel.create({
      categoryId: category._id,
      name: 'Trà thử',
      slug: 'tra-thu',
      image: '/menu-images/test.webp',
      basePrice: 30000,
      allowedOptions: {
        sizes: [],
        sugarLevels: ['50%'],
        iceLevels: ['normal-ice'],
        toppingIds: [],
      },
    });
    const saved = await request(app)
      .put(`${base}/recipes/PRODUCT/${product.id}`)
      .set(admin)
      .send({
        enabled: false,
        components: [{ ingredientId: item.id, quantity: 10 }],
        variants: [],
        expectedVersion: 0,
      });
    expect(saved.status).toBe(200);
    expect((await deleteIngredient(item.id)).status).toBe(409);
  });
});

describe('xóa voucher chưa dùng', () => {
  const del = (id: string, who = admin) =>
    request(app).delete(`/api/v1/admin/vouchers/${id}`).set(who);

  it('xóa voucher chưa dùng, có audit; nhân viên không xóa được', async () => {
    const v = await newVoucher('XOA1');
    expect((await del(v.id, staff)).status).toBe(403);
    expect((await del(v.id)).status).toBe(200);
    expect(await VoucherModel.exists({ _id: v.id })).toBeNull();
    expect(await AuditLogModel.exists({ action: 'voucher.deleted', entityId: v.id })).toBeTruthy();
    expect((await del(v.id)).status).toBe(404);
  });

  it('không xóa voucher đã gắn với đơn, kể cả lượt đã trả lại khi hủy đơn', async () => {
    const v = await newVoucher('XOA2');
    await VoucherUseModel.create({
      voucherId: v.id,
      orderId: new mongoose.Types.ObjectId(),
      state: 'RELEASED',
    });
    const res = await del(v.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('VOUCHER_IN_USE');

    const held = await newVoucher('XOA3');
    await VoucherModel.updateOne({ _id: held.id }, { $set: { usedCount: 1 } });
    expect((await del(held.id)).status).toBe(409);
  });
});
