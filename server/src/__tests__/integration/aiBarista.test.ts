import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { buildApp } from '../../app.js';
import { UserModel } from '../../models/User.js';
import { CategoryModel } from '../../models/Category.js';
import { ProductModel } from '../../models/Product.js';
import { AuditLogModel } from '../../models/AuditLog.js';
import { hashPassword } from '../../utils/crypto.js';
import { AIService } from '../../services/aiService.js';
import type { AIProvider, AIProviderMessage } from '../../providers/aiProvider.js';

let repl: MongoMemoryReplSet;
let app: ReturnType<typeof buildApp>;
let admin: Record<string, string>;
let staff: Record<string, string>;
let categoryId: string;

class FakeProvider implements AIProvider {
  readonly name = 'fake';
  calls: AIProviderMessage[][] = [];
  constructor(private readonly reply: string | (() => never)) {}
  async chat(messages: AIProviderMessage[]): Promise<string> {
    this.calls.push(messages);
    if (typeof this.reply === 'function') this.reply();
    return this.reply as string;
  }
  userPayload(index = 0): Record<string, unknown> {
    return JSON.parse(this.calls[index]![1]!.content) as Record<string, unknown>;
  }
}

const intent = (extra: Record<string, unknown>) =>
  JSON.stringify({ message: 'Mình hiểu bạn cần gì rồi.', ...extra });

async function seedMenu(extraCount = 0): Promise<Record<string, string>> {
  const base = {
    categoryId,
    image: '/menu-images/test.webp',
    allowedOptions: { sizes: [], sugarLevels: ['0%', '50%'], iceLevels: [], toppingIds: [] },
  };
  const rows = [
    {
      key: 'espresso',
      name: 'Cà phê đen đá',
      description: 'Đậm và đắng',
      basePrice: 30_000,
      tags: ['tỉnh táo', 'đậm vị'],
      ingredientMetadata: { caffeine: true, dairy: false, flavorProfile: ['đắng'] },
    },
    {
      key: 'latte',
      name: 'Bạc xỉu',
      description: 'Sữa béo',
      basePrice: 35_000,
      tags: ['béo ngậy', 'tỉnh táo'],
      ingredientMetadata: { caffeine: true, dairy: true, flavorProfile: ['béo', 'ngọt'] },
    },
    {
      key: 'peach',
      name: 'Trà đào cam sả',
      description: 'Chua thanh',
      basePrice: 39_000,
      tags: ['mát lạnh', 'ngày nóng', 'hương trái cây'],
      ingredientMetadata: { caffeine: true, dairy: false, flavorProfile: ['chua'] },
    },
    {
      key: 'soda',
      name: 'Soda chanh dây',
      description: 'Sủi bọt',
      basePrice: 32_000,
      tags: ['mát lạnh', 'sảng khoái', 'ngày nóng'],
      ingredientMetadata: { caffeine: false, dairy: false, flavorProfile: ['chua'] },
    },
    {
      key: 'cacao',
      name: 'Cacao nóng',
      description: 'Ấm áp',
      basePrice: 45_000,
      tags: ['ấm nóng', 'ngày mưa', 'tráng miệng'],
      ingredientMetadata: { caffeine: false, dairy: true, flavorProfile: ['béo', 'ngọt'] },
    },
  ];
  const ids: Record<string, string> = {};
  for (const { key, ...row } of rows)
    ids[key] = (await ProductModel.create({ ...base, ...row, slug: key })).id;
  for (let index = 0; index < extraCount; index += 1)
    await ProductModel.create({
      ...base,
      name: `Món thêm ${index}`,
      slug: `extra-${index}`,
      description: 'Món phụ để kiểm tra kích thước menu',
      basePrice: 50_000 + index,
      ingredientMetadata: { caffeine: true, dairy: true, flavorProfile: [] },
    });
  return ids;
}

beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(repl.getUri());
  app = buildApp();
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  for (const role of ['ADMIN', 'STAFF'] as const) {
    const user = await UserModel.create({
      name: role,
      email: `${role}@ai.vn`,
      role,
      isActive: true,
      passwordHash: await hashPassword('Password@123'),
    });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'Password@123' });
    expect(login.status).toBe(200);
    const headers = { Authorization: `Bearer ${login.body.data.accessToken}` };
    if (role === 'ADMIN') admin = headers;
    else staff = headers;
  }
}, 120000);
beforeEach(async () => {
  await Promise.all(
    [CategoryModel, ProductModel, AuditLogModel].map((model) => model.collection.deleteMany({})),
  );
  categoryId = (await CategoryModel.create({ name: 'Đồ uống', slug: 'do-uong' })).id;
});
afterAll(async () => {
  await mongoose.disconnect();
  await repl.stop();
});

describe('AI Barista — rules router (B)', () => {
  it('answers prompts the rules understand without calling the model', async () => {
    const ids = await seedMenu();
    const provider = new FakeProvider(intent({}));
    const service = new AIService(provider, 'live');
    for (const prompt of ['trà đào ít ngọt', 'không caffeine dưới 40k', 'gợi ý món gì ngon']) {
      const result = await service.recommend({ prompt });
      expect(result).toMatchObject({ mode: 'fallback', route: 'rules' });
      expect(result.recommendations.length).toBeGreaterThan(0);
    }
    expect(provider.calls).toHaveLength(0);
    const peach = await service.recommend({ prompt: 'trà đào' });
    expect(peach.recommendations[0]!.productId).toBe(ids.peach);
    const noCaffeine = await service.recommend({ prompt: 'không caffeine dưới 40k' });
    expect(noCaffeine.recommendations.map((item) => item.productId)).toEqual([ids.soda]);
  });

  it('keeps fallback mode rules-only and still finds tag matches', async () => {
    const ids = await seedMenu();
    const result = await new AIService(null, 'fallback').recommend({ prompt: 'món mát lạnh' });
    expect(result.route).toBe('rules');
    expect(result.recommendations.map((item) => item.productId)).toEqual(
      expect.arrayContaining([ids.soda, ids.peach]),
    );
  });
});

describe('AI Barista — model extracts intent only (A)', () => {
  it('ranks the real menu from model tags and explains with stored data', async () => {
    const ids = await seedMenu();
    const provider = new FakeProvider(intent({ tags: ['tỉnh táo'], flavors: ['bitter'] }));
    const result = await new AIService(provider, 'live').recommend({ prompt: 'buồn ngủ quá' });
    expect(provider.calls).toHaveLength(1);
    expect(result).toMatchObject({
      mode: 'llm',
      route: 'llm',
      message: 'Mình hiểu bạn cần gì rồi.',
    });
    expect(result.recommendations[0]!.productId).toBe(ids.espresso);
    expect(result.recommendations[0]!.reason).toContain('hợp: tỉnh táo');
    expect(result.recommendations[0]!.unitPrice).toBe(30_000);
  });

  it('sends a payload that does not contain the menu and does not grow with it', async () => {
    await seedMenu();
    const small = new FakeProvider(intent({}));
    await new AIService(small, 'live').recommend({ prompt: 'uống gì cho bạn gái' });
    const smallPayload = small.calls[0]![1]!.content;
    expect(small.userPayload()).not.toHaveProperty('menu');
    for (const name of ['Cà phê đen đá', 'Trà đào cam sả'])
      expect(smallPayload).not.toContain(name);
    expect(smallPayload).not.toMatch(/[a-f\d]{24}/);

    await ProductModel.deleteMany({});
    await seedMenu(60);
    const large = new FakeProvider(intent({}));
    await new AIService(large, 'live').recommend({ prompt: 'uống gì cho bạn gái' });
    expect(large.calls[0]![1]!.content.length).toBe(smallPayload.length);
  });

  it('lets the model add constraints but never loosen the guest choices', async () => {
    const ids = await seedMenu();
    const strict = new FakeProvider(
      intent({ noCaffeine: true, groupsExclude: ['coffee'], tags: ['mát lạnh'] }),
    );
    const added = await new AIService(strict, 'live').recommend({ prompt: 'sợ mất ngủ lắm' });
    expect(added.recommendations.map((item) => item.productId)).toEqual([ids.soda, ids.cacao]);
    for (const item of added.recommendations) {
      expect(item.evidence.caffeine).toBe(false);
      expect(item.reason).toContain('metadata xác nhận không caffeine');
    }
    expect(added.recommendations[0]!.reason).toContain('hợp: mát lạnh');

    const loose = new FakeProvider(intent({ noDairy: false, maxBudget: 100_000 }));
    const kept = await new AIService(loose, 'live').recommend({
      prompt: 'muốn thứ gì đó thật đặc biệt',
      maxBudget: 34_000,
      preferences: { noDairy: true },
    });
    expect(kept.recommendations.map((item) => item.productId).sort()).toEqual(
      [ids.espresso, ids.soda].sort(),
    );
    for (const item of kept.recommendations) {
      expect(item.unitPrice).toBeLessThanOrEqual(34_000);
      expect(item.evidence.dairy).toBe(false);
    }
  });

  it('steers "tỉnh táo" to coffee/tea even before products are tagged', async () => {
    const base = {
      categoryId,
      image: '/menu-images/test.webp',
      allowedOptions: { sizes: [], sugarLevels: [], iceLevels: [], toppingIds: [] },
    };
    await ProductModel.create({
      ...base,
      name: 'Bánh Cookie Socola',
      slug: 'cookie',
      basePrice: 28_000,
      isFeatured: true,
      ingredientMetadata: { caffeine: false, dairy: true, flavorProfile: ['ngọt'] },
    });
    const coffee = await ProductModel.create({
      ...base,
      name: 'Cà phê sữa đá',
      slug: 'ca-phe-sua-da',
      basePrice: 29_000,
      ingredientMetadata: { caffeine: true, dairy: true, flavorProfile: ['đậm'] },
    });
    const provider = new FakeProvider(intent({ tags: ['tỉnh táo'] }));
    const result = await new AIService(provider, 'live').recommend({ prompt: 'buồn ngủ quá' });
    expect(result.recommendations.map((item) => item.productId)).toEqual([coffee.id]);

    const decaf = new FakeProvider(intent({ tags: ['tỉnh táo'], noCaffeine: true }));
    const noCaffeine = await new AIService(decaf, 'live').recommend({ prompt: 'buồn ngủ quá' });
    expect(noCaffeine.recommendations.map((item) => item.name)).toEqual(['Bánh Cookie Socola']);
  });

  it('applies a model budget when the guest gave none', async () => {
    const ids = await seedMenu();
    const provider = new FakeProvider(intent({ maxBudget: 31_000 }));
    const result = await new AIService(provider, 'live').recommend({
      prompt: 'ví hơi mỏng, chọn giúp mình',
    });
    expect(result.recommendations.map((item) => item.productId)).toEqual([ids.espresso]);
  });

  it('treats preferred groups as soft when nothing in them qualifies', async () => {
    await seedMenu();
    const provider = new FakeProvider(intent({ groupsInclude: ['tea'], noDairy: true }));
    const result = await new AIService(provider, 'live').recommend({
      prompt: 'thèm gì đó nhẹ nhàng',
      maxBudget: 35_000,
    });
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it.each([
    ['invalid JSON', 'không phải json'],
    [
      'provider error',
      () => {
        throw new Error('AI provider returned 401');
      },
    ],
  ])('falls back to rules transparently on %s', async (_label, reply) => {
    await seedMenu();
    const provider = new FakeProvider(reply as string | (() => never));
    const result = await new AIService(provider, 'live').recommend({ prompt: 'buồn ngủ quá' });
    expect(provider.calls).toHaveLength(1);
    expect(result).toMatchObject({ mode: 'fallback', route: 'llm_fallback' });
    expect(result.message).toContain('AI tạm thời không khả dụng');
  });

  it('returns an empty list instead of relaxing impossible constraints', async () => {
    await seedMenu();
    const provider = new FakeProvider(
      intent({ noCaffeine: true, noDairy: true, maxBudget: 20_000 }),
    );
    const result = await new AIService(provider, 'live').recommend({ prompt: 'đang bầu, ví mỏng' });
    expect(result.recommendations).toEqual([]);
    expect(result.message).toContain('Hiện chưa có món phù hợp');
  });
});

describe('Admin tag suggestions (C)', () => {
  it('suggests vocabulary tags from stored text without saving anything', async () => {
    await seedMenu();
    const before = await ProductModel.find().lean();
    const audits = await AuditLogModel.countDocuments();
    const body = {
      name: 'Trà vải hoa nhài',
      description: 'Thanh mát, uống lạnh',
      categoryId,
      tags: ['thanh nhẹ'],
      caffeine: false,
    };
    const response = await request(app)
      .post('/api/v1/admin/products/ai-tag-suggestions')
      .set(admin)
      .send(body);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.body.data.mode).toBe('fallback');
    expect(response.body.data.tags).toEqual(
      expect.arrayContaining(['hương trái cây', 'hương hoa', 'mát lạnh']),
    );
    expect(response.body.data.tags).not.toContain('thanh nhẹ');
    expect(response.body.data.tags).not.toContain('tỉnh táo');
    expect(await ProductModel.find().lean()).toEqual(before);
    expect(await AuditLogModel.countDocuments()).toBe(audits);
  });

  it('is admin-only and validates input', async () => {
    const endpoint = '/api/v1/admin/products/ai-tag-suggestions';
    expect((await request(app).post(endpoint).send({ name: 'x' })).status).toBe(401);
    expect((await request(app).post(endpoint).set(staff).send({ name: 'x' })).status).toBe(403);
    expect((await request(app).post(endpoint).set(admin).send({ name: '' })).status).toBe(422);
  });

  it('filters invented tags and caffeine claims from the model', async () => {
    const provider = new FakeProvider(
      JSON.stringify({ tags: ['tỉnh táo', 'giảm cân', 'Mát Lạnh', 'thư giãn', 'thư giãn'] }),
    );
    const service = new AIService(provider, 'live');
    const result = await service.suggestTags({
      name: 'Nước ép dưa hấu',
      categoryId,
      tags: ['thư giãn'],
      caffeine: false,
    });
    expect(result).toEqual({ mode: 'llm', tags: ['mát lạnh'] });
    expect(JSON.parse(provider.calls[0]![1]!.content)).toMatchObject({
      category: 'Đồ uống',
      currentTags: ['thư giãn'],
    });

    const broken = await new AIService(
      new FakeProvider(() => {
        throw new Error('timeout');
      }),
      'live',
    ).suggestTags({ name: 'Cà phê muối', description: 'đậm', caffeine: true });
    expect(broken.mode).toBe('fallback');
    expect(broken.tags).toEqual(expect.arrayContaining(['tỉnh táo', 'đậm vị']));
  });
});
