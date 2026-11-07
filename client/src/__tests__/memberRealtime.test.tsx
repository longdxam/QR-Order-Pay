// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AdminMembers } from '../features/admin/Members';
import { MemberPage } from '../features/guest/MemberPage';
import { GuestLayout } from '../layouts/GuestLayout';
import { ToastProvider } from '../components/ui/Toast';
import { useCart } from '../store/cart';

const mock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  listeners: new Map<string, Set<(data?: unknown) => void>>(),
}));
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  api: mock,
}));
vi.mock('../lib/socket', async () => {
  const { useEffect, useRef } = await import('react');
  return {
    connectGuestSocket: () => ({ connected: true }),
    disconnectSocket: vi.fn(),
    useSocketEvent: (event: string, callback: (data?: unknown) => void) => {
      const ref = useRef(callback);
      ref.current = callback;
      useEffect(() => {
        const handler = (data?: unknown) => ref.current(data);
        if (!mock.listeners.has(event)) mock.listeners.set(event, new Set());
        mock.listeners.get(event)!.add(handler);
        return () => {
          mock.listeners.get(event)?.delete(handler);
        };
      }, [event]);
    },
  };
});
const response = (data: unknown) => ({ data: { success: true, data } });
const originalMember = {
  id: 'member1',
  name: 'Khách thử',
  phone: '0901234567',
  points: 37,
  isActive: true,
  version: 1,
  createdAt: new Date().toISOString(),
};
let member = { ...originalMember },
  entries: Array<Record<string, unknown>> = [],
  qc: QueryClient;
function mount(ui: JSX.Element) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/member']}>{ui}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}
function emit(event: string) {
  act(() => {
    for (const handler of mock.listeners.get(event) ?? [])
      handler({ orderId: 'order1', tableSessionId: 'session1' });
  });
}
beforeEach(() => {
  member = { ...originalMember };
  entries = [];
  mock.get.mockImplementation(async (path: string) => {
    if (path === '/admin/members') return response({ items: [member], total: 1 });
    if (path === '/members/me') return response({ member });
    if (path.includes('/points')) return response({ items: entries, total: entries.length });
    if (path === '/table-sessions/current')
      return response({
        active: true,
        tableSessionId: 'session1',
        participantId: 'guest1',
        status: 'OPEN',
        table: { id: 'table1', name: 'Bàn 01', code: 'B01' },
      });
    if (path === '/gifts') return response({ items: [], total: 0, incomingCount: 0 });
    throw new Error(`Unexpected read: ${path}`);
  });
});
afterEach(() => {
  cleanup();
  qc.clear();
  mock.listeners.clear();
  vi.clearAllMocks();
  useCart.getState().resetSession();
});
describe('member balance refresh after order activity', () => {
  it('updates both the admin list and an open member dialog on redemption, return, earning and reconnect', async () => {
    mount(<AdminMembers />);
    fireEvent.click(await screen.findByRole('button', { name: 'Chi tiết' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('37 điểm')).toBeTruthy();
    await waitFor(() => expect(qc.isFetching({ queryKey: ['admin-member-points'] })).toBe(0));
    member = { ...member, points: 25, version: 2 };
    entries = [
      {
        id: 'redeem1',
        orderCode: 'MC01',
        type: 'REDEEM',
        points: -12,
        balanceAfter: 25,
        createdAt: new Date().toISOString(),
      },
    ];
    emit('order.created');
    await within(dialog).findByText('25 điểm');
    await screen.findByText(/0901234567 · 25 điểm/);
    await within(dialog).findByText('-12 · Còn 25');
    member = { ...member, points: 37, version: 3 };
    emit('order.statusChanged');
    await within(dialog).findByText('37 điểm');
    member = { ...member, points: 42, version: 4 };
    emit('order.statusChanged');
    await within(dialog).findByText('42 điểm');
    const reads = mock.get.mock.calls.length;
    emit('connect');
    await waitFor(() => expect(mock.get.mock.calls.length).toBeGreaterThan(reads));
    expect(mock.post).not.toHaveBeenCalled();
  });
  it('refreshes the guest balance and point ledger while the member page stays open', async () => {
    mount(
      <Routes>
        <Route element={<GuestLayout />}>
          <Route path="/member" element={<MemberPage />} />
        </Route>
      </Routes>,
    );
    await screen.findByText('37 điểm');
    member = { ...member, points: 25, version: 2 };
    entries = [
      {
        id: 'redeem1',
        orderCode: 'MC01',
        type: 'REDEEM',
        points: -12,
        balanceAfter: 25,
        createdAt: new Date().toISOString(),
      },
    ];
    emit('order.created');
    await screen.findByText('25 điểm');
    await screen.findByText('Đổi điểm · MC01');
    expect(mock.post).not.toHaveBeenCalled();
  });
});
