// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { api } from '../lib/api';
import { useAuth } from '../features/auth/useAuth';

interface PlannedResponse {
  status: number;
  data?: unknown;
}

interface RecordedCall {
  url?: string;
  authorization: string | null;
  idempotencyKey: string | null;
  body: unknown;
}

const fakeUser = { id: 'u1', name: 'Staff A', email: 'staff.a@maycafe.vn', role: 'STAFF' as const };

const calls: RecordedCall[] = [];

let plan: (config: InternalAxiosRequestConfig) => PlannedResponse | Promise<PlannedResponse>;

const ok = (data: unknown): PlannedResponse => ({ status: 200, data: { success: true, data } });
const unauthorized = (): PlannedResponse => ({ status: 401, data: { success: false, error: { code: 'UNAUTHENTICATED', message: 'Phiên hết hạn.' } } });

const mockAdapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
  const headerValue = (name: string): string | null => {
    const v = config.headers?.get(name);
    return typeof v === 'string' ? v : null;
  };
  calls.push({
    url: config.url,
    authorization: headerValue('Authorization'),
    idempotencyKey: headerValue('Idempotency-Key'),
    body: config.data,
  });
  const { status, data } = await plan(config);
  const response: AxiosResponse = { status, data, statusText: '', headers: {}, config };
  const validateStatus = (config.validateStatus as ((s: number) => boolean) | undefined) ?? ((s: number) => s >= 200 && s < 300);
  if (validateStatus(status)) return response;
  throw new AxiosError(`Request failed with status code ${status}`, AxiosError.ERR_BAD_REQUEST, config, null, response);
};

const countCalls = (url: string): number => calls.filter((c) => c.url === url).length;

function seedStaffSession(token: string | null, epoch = 1): void {
  useAuth.setState({ accessToken: token, user: token ? fakeUser : null, sessionEpoch: epoch });
}

beforeEach(() => {
  calls.length = 0;
  plan = () => ok({});
  api.defaults.adapter = mockAdapter;
  seedStaffSession('expired-token');
});

afterEach(() => {
  useAuth.setState({ accessToken: null, user: null, sessionEpoch: 0 });
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('staff auth refresh single-flight', () => {
  it('shares one refresh for concurrent 401s and retries both with the new token', async () => {
    plan = (config) => {
      const url = config.url ?? '';
      if (url === '/auth/refresh') return ok({ accessToken: 'new-token', user: fakeUser });
      if (url === '/staff/orders') return countCalls('/staff/orders') <= 2 ? unauthorized() : ok({ orders: [] });
      return ok({});
    };
    const [a, b] = await Promise.all([api.get('/staff/orders'), api.get('/staff/orders')]);
    expect(countCalls('/auth/refresh')).toBe(1);
    expect(countCalls('/staff/orders')).toBe(4);
    expect((a.data as { data: { orders: unknown[] } }).data.orders).toEqual([]);
    expect((b.data as { data: { orders: unknown[] } }).data.orders).toEqual([]);
    const retried = calls.filter((c) => c.url === '/staff/orders').slice(2);
    expect(retried.map((c) => c.authorization)).toEqual(['Bearer new-token', 'Bearer new-token']);
    expect(useAuth.getState().accessToken).toBe('new-token');
  });

  it('clears the failed session once when refresh fails, without extra refreshes', async () => {
    plan = (config) => {
      const url = config.url ?? '';
      if (url === '/auth/refresh') return unauthorized();
      if (url === '/staff/orders') return unauthorized();
      return ok({});
    };
    const results = await Promise.allSettled([api.get('/staff/orders'), api.get('/staff/orders')]);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(countCalls('/auth/refresh')).toBe(1);
    expect(countCalls('/staff/orders')).toBe(2);
    expect(useAuth.getState().accessToken).toBeNull();
    expect(useAuth.getState().user).toBeNull();
  });

  it('retries at most once: a second 401 after refresh is not refreshed again', async () => {
    plan = (config) => {
      const url = config.url ?? '';
      if (url === '/auth/refresh') return ok({ accessToken: 'new-token', user: fakeUser });
      if (url === '/staff/orders') return unauthorized();
      return ok({});
    };
    await expect(api.get('/staff/orders')).rejects.toMatchObject({ response: { status: 401 } });
    expect(countCalls('/auth/refresh')).toBe(1);
    expect(countCalls('/staff/orders')).toBe(2);
    expect(useAuth.getState().accessToken).toBe('new-token');
  });

  it('does not resurrect a session logged out while a refresh is in flight', async () => {
    let resolveRefresh!: (r: PlannedResponse) => void;
    plan = (config) => {
      const url = config.url ?? '';
      if (url === '/staff/orders') return unauthorized();
      if (url === '/auth/refresh') {
        return new Promise<PlannedResponse>((resolve) => {
          resolveRefresh = resolve;
        });
      }
      if (url === '/auth/logout') return ok({ ok: true });
      return ok({});
    };
    const pending = api.get('/staff/orders');
    await vi.waitFor(() => expect(countCalls('/auth/refresh')).toBe(1));
    await useAuth.getState().logout();
    resolveRefresh(ok({ accessToken: 'late-token', user: fakeUser }));
    await expect(pending).rejects.toMatchObject({ response: { status: 401 } });
    await Promise.resolve();
    expect(useAuth.getState().accessToken).toBeNull();
    expect(useAuth.getState().user).toBeNull();
    expect(countCalls('/staff/orders')).toBe(1);
    expect(countCalls('/auth/refresh')).toBe(1);
  });

  it('preserves body and Idempotency-Key header on the single retry', async () => {
    plan = (config) => {
      const url = config.url ?? '';
      if (url === '/auth/refresh') return ok({ accessToken: 'new-token', user: fakeUser });
      if (url === '/orders') return countCalls('/orders') === 1 ? unauthorized() : ok({ id: 'o1' });
      return ok({});
    };
    const res = await api.post('/orders', { items: [{ productId: 'p1', quantity: 1 }] }, { headers: { 'Idempotency-Key': 'idem-key-123' } });
    expect((res.data as { data: { id: string } }).data.id).toBe('o1');
    const orderCalls = calls.filter((c) => c.url === '/orders');
    expect(orderCalls).toHaveLength(2);
    expect(orderCalls[0]!.idempotencyKey).toBe('idem-key-123');
    expect(orderCalls[1]!.idempotencyKey).toBe('idem-key-123');
    expect(orderCalls[1]!.body).toBe(JSON.stringify({ items: [{ productId: 'p1', quantity: 1 }] }));
    expect(orderCalls[1]!.authorization).toBe('Bearer new-token');
  });

  it('skips refresh for guest requests and auth endpoints on 401', async () => {
    plan = (config) => {
      const url = config.url ?? '';
      if (url === '/auth/login' || url === '/orders/mine') return unauthorized();
      return ok({});
    };
    const loginRejected = api.post('/auth/login', { email: 'staff.a@maycafe.vn', password: 'wrong-password' });
    await expect(loginRejected).rejects.toMatchObject({ response: { status: 401 } });
    expect(countCalls('/auth/refresh')).toBe(0);

    seedStaffSession(null);
    await expect(api.get('/orders/mine')).rejects.toMatchObject({ response: { status: 401 } });
    expect(countCalls('/auth/refresh')).toBe(0);
    expect(useAuth.getState().accessToken).toBeNull();
  });
});
