import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { config } from '../../config/index.js';

vi.mock('../../infrastructure/redis.js', async (original) => {
  const actual = await original<typeof import('../../infrastructure/redis.js')>();
  const { MemoryStore } = await import('express-rate-limit');
  return { ...actual, createRateLimitStore: () => new MemoryStore() };
});
const previous = {
  env: config.env,
  quote: config.rateLimits.guestQuotePerMinute,
  order: config.rateLimits.guestOrderPerMinute,
};
let app: ReturnType<(typeof import('../../app.js'))['buildApp']>;
beforeAll(async () => {
  // Exercise the real production middleware with isolated in-memory stores.
  Object.assign(config, { env: 'production' });
  Object.assign(config.rateLimits, { guestQuotePerMinute: 2, guestOrderPerMinute: 1 });
  app = (await import('../../app.js')).buildApp();
});
afterAll(() => {
  Object.assign(config, { env: previous.env });
  Object.assign(config.rateLimits, {
    guestQuotePerMinute: previous.quote,
    guestOrderPerMinute: previous.order,
  });
});

describe('quote request isolation from order creation', () => {
  it('limits previews independently and returns structured Vietnamese errors with Retry-After', async () => {
    for (let i = 0; i < 2; i++)
      expect((await request(app).post('/api/v1/orders/quote').send({})).status).toBe(401);
    const limited = await request(app).post('/api/v1/orders/quote').send({});
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({
      success: false,
      error: { code: 'RATE_LIMITED', message: expect.stringContaining('Vui lòng') },
      requestId: expect.any(String),
    });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    // Exhausting the quote budget must leave the order budget untouched.
    expect((await request(app).post('/api/v1/orders').send({})).status).toBe(401);
    expect((await request(app).post('/api/v1/orders').send({})).status).toBe(429);
  });
});
