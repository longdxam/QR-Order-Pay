// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui/Toast';
import { StaffKDS } from '../features/staff/KDS';
const mock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  api: mock,
}));
vi.mock('../lib/socket', () => ({ getSocket: () => null }));
const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
afterEach(() => {
  cleanup();
  qc.clear();
  vi.resetAllMocks();
});
it('puts the preparation queues before collapsed cancellation history and links collection to its primary page', async () => {
  mock.get.mockImplementation(async (path: string) => ({
    data: { data: { items: path === '/staff/awaiting-payments' ? [{ _id: 'awaiting' }] : [] } },
  }));
  render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <StaffKDS />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const queue = await screen.findByRole('region', { name: 'Đang pha' });
  const history = screen.getByText('Lịch sử đơn đã hủy').closest('details')!;
  expect(history.open).toBe(false);
  expect(queue.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByRole('link', { name: /Thu tiền tại Bàn & phiên/ }).getAttribute('href')).toBe(
    '/staff/tables#awaiting-payments',
  );
  expect(mock.post).not.toHaveBeenCalled();
});
