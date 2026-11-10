// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdminOperations } from '../features/admin/Operations';

const mock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  api: mock,
}));
vi.mock('../features/admin/AnomalyPanel', () => ({
  AnomalyPanel: () => <h2>Cảnh báo bất thường</h2>,
}));
const response = (data: unknown) => ({ data: { success: true, data } });
function summary() {
  return {
    observedAt: new Date().toISOString(),
    instance: {
      scope: 'instance',
      instanceId: 'internal-a',
      startedAt: new Date().toISOString(),
      uptimeSeconds: 120,
      http: { requests: 200, clientErrors: 2, rateLimited: 1, serverErrors: 0 },
      businessEvents: {},
      orderStageDurations: Object.fromEntries(
        ['acceptance', 'preparation', 'service'].map((key) => [
          key,
          { count: 0, averageSeconds: null },
        ]),
      ),
      sockets: { guest: 2, staff: 1 },
      dependencies: { mongodb: true, redis: true },
      process: { rssBytes: 1000000, heapUsedBytes: 500000 },
    },
    database: {
      scope: 'database',
      mongodbReady: true,
      redisReady: true,
      activeSessions: 2,
      openServiceRequests: 1,
      activeOrders: 4,
      ordersByStatus: { PENDING: 1, CONFIRMED: 1, PREPARING: 1, READY: 1 },
      oldestQueuedAt: null,
      oldestQueueAgeSeconds: 120,
      queues: {
        realtime: {
          pending: 0,
          processing: 0,
          oldestPendingAgeSeconds: 0,
          expiredProcessing: 0,
          retryingSampleCount: 0,
        },
        reports: {
          pending: 0,
          processing: 0,
          oldestPendingAgeSeconds: 0,
          expiredProcessing: 0,
          retryingSampleCount: 0,
        },
        deadLetters: 0,
        workers: ['scheduler', 'realtime', 'report'].map((role) => ({
          id: role,
          role,
          updatedAt: new Date().toISOString(),
        })),
        redisMemory: { usedBytes: 1000000, maxBytes: 2000000, policy: 'noeviction', keyCount: 3 },
      },
      outbox: { pending: 0, processing: 0, published: 3, failed: 0 },
    },
  };
}
let queryClient: QueryClient;
beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mock.get.mockImplementation(async (path: string) =>
    response(path.endsWith('/summary') ? summary() : { outbox: [], deadLetters: [] }),
  );
  mock.post.mockResolvedValue(response({ queued: true }));
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.clearAllMocks();
});
function mount() {
  render(
    <QueryClientProvider client={queryClient}>
      <AdminOperations />
    </QueryClientProvider>,
  );
}

it('shows serving activity first and keeps technical metrics in a closed disclosure', async () => {
  mount();
  await screen.findByRole('heading', { name: 'Vận hành', level: 1 });
  expect(screen.getByText('Bàn đang phục vụ')).toBeTruthy();
  expect(screen.getByText('Đơn đang xử lý')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Tiến độ đơn hàng' })).toBeTruthy();
  expect(await screen.findByText('Không có tác vụ lỗi cần thử lại.')).toBeTruthy();
  const details = screen.getByText('Chi tiết kỹ thuật').closest('details');
  expect(details?.hasAttribute('open')).toBe(false);
  expect(details?.contains(screen.getByRole('heading', { name: 'Máy chủ internal-a' }))).toBe(true);
});

it('does not report an empty failure list as successful when the request fails', async () => {
  mock.get.mockImplementation(async (path: string) => {
    if (path.endsWith('/failures')) throw new Error('Không tải được tác vụ');
    return response(summary());
  });
  mount();
  await screen.findByRole('button', { name: 'Thử lại' });
  expect(screen.queryByText('Không có tác vụ lỗi cần thử lại.')).toBeNull();
  expect(screen.getByRole('heading', { name: 'Hệ thống cần kiểm tra' })).toBeTruthy();
});
it('flags a missing background role instead of showing a healthy system', async () => {
  const data = summary();
  data.database.queues.workers = data.database.queues.workers.slice(0, 1);
  mock.get.mockImplementation(async (path: string) =>
    response(path.endsWith('/summary') ? data : { outbox: [], deadLetters: [] }),
  );
  mount();
  await screen.findByText('Cần kiểm tra dịch vụ xử lý nền');
  expect(screen.queryByRole('heading', { name: 'Kết nối hệ thống ổn định' })).toBeNull();
});

it('retains the retry actions and routes each kind to the correct endpoint', async () => {
  mock.get.mockImplementation(async (path: string) =>
    response(
      path.endsWith('/summary')
        ? summary()
        : {
            outbox: [
              {
                eventId: 'event-1',
                eventType: 'order.created',
                aggregateType: 'Order',
                aggregateId: 'order-1',
                attempts: 2,
                lastError: 'Offline',
              },
            ],
            deadLetters: [
              {
                job: { id: 'job-1', type: 'report' },
                error: 'Offline',
                failedAt: new Date().toISOString(),
              },
            ],
          },
    ),
  );
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Gửi lại thông báo' }));
  await waitFor(() =>
    expect(mock.post).toHaveBeenCalledWith('/admin/operations/outbox/event-1/replay'),
  );
  const retryJob = screen.getByRole('button', { name: 'Chạy lại tác vụ' }) as HTMLButtonElement;
  await waitFor(() => expect(retryJob.disabled).toBe(false));
  fireEvent.click(retryJob);
  await waitFor(() =>
    expect(mock.post).toHaveBeenCalledWith('/admin/operations/jobs/job-1/replay'),
  );
});

it('refreshes both the summary and failure list', async () => {
  mount();
  const refresh = (await screen.findByRole('button', { name: 'Làm mới' })) as HTMLButtonElement;
  await waitFor(() => expect(refresh.disabled).toBe(false));
  mock.get.mockClear();
  fireEvent.click(refresh);
  await waitFor(() => {
    expect(mock.get).toHaveBeenCalledWith('/admin/operations/summary');
    expect(mock.get).toHaveBeenCalledWith('/admin/operations/failures');
  });
});
