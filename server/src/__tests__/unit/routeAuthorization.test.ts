import { describe, expect, it, vi } from 'vitest';
import { listRoutes } from './routeTable.js';

// requireRole trả closure ẩn danh giống hệt nhau cho mọi role; đặt tên theo role để kiểm được quyền.
vi.mock('../../middlewares/auth.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../middlewares/auth.js')>();
  return {
    ...original,
    requireRole: (...roles: Array<'ADMIN' | 'STAFF'>) =>
      Object.defineProperty(original.requireRole(...roles), 'name', {
        value: `requireRole:${roles.join(',')}`,
      }),
  };
});

const { apiRouter } = await import('../../routes/index.js');
const routes = listRoutes(apiRouter);

const label = (route: { method: string; path: string }): string => `${route.method} ${route.path}`;

describe('API route authorization matrix', () => {
  it('registers the full API surface', () => {
    expect(routes.length).toBeGreaterThan(150);
    expect(new Set(routes.map(label)).size, 'duplicate method+path').toBe(routes.length);
  });

  it('never lets an earlier parameterised route swallow a later one', () => {
    // Ví dụ `/orders/:id` đăng ký trước sẽ nuốt `/orders/mine`. Router được tách nhiều file nên cần chặn.
    const shadowed: string[] = [];
    routes.forEach((route, index) => {
      for (const earlier of routes.slice(0, index)) {
        if (earlier.method !== route.method) continue;
        const pattern = new RegExp(`^${earlier.path.replace(/:[A-Za-z]+/g, '[^/]+')}$`);
        if (pattern.test(route.path)) shadowed.push(`${label(route)} ← ${earlier.path}`);
      }
    });
    expect(shadowed).toEqual([]);
  });

  it('requires an authenticated ADMIN for every /admin route', () => {
    const admin = routes.filter((route) => route.path.startsWith('/admin'));
    expect(admin.length).toBeGreaterThan(50);
    for (const route of admin) {
      expect(route.chain, label(route)).toContain('requireAuth');
      expect(route.chain, label(route)).toContain('requireRole:ADMIN');
      expect(route.chain.indexOf('requireAuth'), label(route)).toBeLessThan(
        route.chain.indexOf('requireRole:ADMIN'),
      );
    }
  });

  it('requires an authenticated STAFF or ADMIN for every /staff route', () => {
    const staff = routes.filter((route) => route.path.startsWith('/staff'));
    expect(staff.length).toBeGreaterThan(30);
    for (const route of staff) {
      expect(route.chain, label(route)).toContain('requireAuth');
      expect(route.chain, label(route)).toContain('requireRole:STAFF,ADMIN');
    }
  });

  it('protects every guest-facing mutation with the CSRF guard', () => {
    const exempt = new Set(['POST /menu/search']);
    const mutations = routes.filter(
      (route) =>
        route.method !== 'GET' &&
        !/^\/(?:auth|staff|admin)(?:\/|$)/.test(route.path) &&
        !exempt.has(label(route)),
    );
    expect(mutations.length).toBeGreaterThan(20);
    for (const route of mutations) expect(route.chain, label(route)).toContain('guestCsrfGuard');
  });

  it('rate-limits sign-in and every guest write that can create orders, gifts or service calls', () => {
    const limited: Array<[string, string]> = [
      ['POST /auth/login', 'rateLimit:auth'],
      ['POST /members/login', 'rateLimit:auth'],
      ['POST /table-sessions/join', 'rateLimit:guest-join'],
      ['POST /orders', 'rateLimit:guest-order'],
      ['POST /orders/quote', 'rateLimit:guest-quote'],
      ['POST /gifts', 'rateLimit:guest-order'],
      ['POST /service-requests', 'rateLimit:guest-service'],
      ['POST /ai/recommendations', 'rateLimit:ai'],
      ['POST /menu/search', 'rateLimit:menu-search'],
    ];
    for (const [route, limiter] of limited)
      expect(routes.find((entry) => label(entry) === route)?.chain, route).toContain(limiter);
  });
});
