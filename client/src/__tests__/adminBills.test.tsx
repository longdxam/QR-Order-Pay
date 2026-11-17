// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AdminBills } from '../features/admin/Bills';
import type { BillHistoryDetail, BillHistoryRow } from '@may-cafe/contracts';

const mock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  api: mock,
}));
const clients: QueryClient[] = [];
const empty: BillHistoryRow = {
  id: 'empty',
  invoiceCode: 'HD20261107-4YW4VP',
  tableCode: 'B02',
  tableName: 'Bàn 02',
  cashierName: 'Nhân viên B',
  closedAt: '2026-11-07T16:40:56.253Z',
  total: 0,
  paidAmount: 0,
  paymentMethods: [],
};
function mount(row: BillHistoryRow, payments: BillHistoryDetail['payments'] = []) {
  mock.get.mockImplementation(async (path: string) => ({
    data: {
      data:
        path === '/admin/bills'
          ? { items: [row], page: 1, limit: 20, total: 1 }
          : {
              ...row,
              tableSessionId: null,
              source: 'STAFF',
              openedAt: '2026-11-07T16:14:23.216Z',
              subtotal: row.total,
              payments,
              orders: [],
            },
    },
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <AdminBills />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.resetAllMocks();
});

describe('invoice payment presentation', () => {
  it('explains an empty zero-value closed session instead of labelling it unknown', async () => {
    mount(empty);
    expect(await screen.findByText('Không phát sinh thu tiền')).toBeTruthy();
    expect(screen.queryByText('Không rõ')).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Chốt lúc' })).toBeTruthy();
    expect(screen.getByText(/23:40:56/)).toBeTruthy();
    expect(screen.queryByText(empty.invoiceCode)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Xem' }));
    const dialog = await screen.findByRole('dialog', { name: 'Chi tiết hóa đơn' });
    expect(
      await within(dialog).findByText('Phiên được đóng khi chưa có món, không phát sinh thu tiền.'),
    ).toBeTruthy();
    expect(within(dialog).queryByText('Tiền mặt')).toBeNull();
    expect(within(dialog).queryByText('Chuyển khoản')).toBeNull();
  });

  it('labels recorded methods in Vietnamese and shows each actual collection separately from closure time', async () => {
    mount(
      {
        ...empty,
        id: 'paid',
        total: 48000,
        paidAmount: 48000,
        paymentMethods: ['CASH', 'BANK_TRANSFER'],
      },
      [
        { method: 'CASH', amount: 20000, paidAt: '2026-11-07T16:20:00.000Z' },
        { method: 'BANK_TRANSFER', amount: 28000, paidAt: '2026-11-07T16:30:00.000Z' },
      ],
    );
    expect(await screen.findByText('Tiền mặt, Chuyển khoản')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Xem' }));
    const collections = await screen.findByRole('list', { name: 'Các khoản thu' });
    expect(within(collections).getAllByRole('listitem')).toHaveLength(2);
    expect(within(collections).getByText('Tiền mặt')).toBeTruthy();
    expect(within(collections).getByText('Chuyển khoản')).toBeTruthy();
    expect(within(collections).getByText(/Thu lúc 23:20:00/)).toBeTruthy();
    expect(within(collections).getByText(/Thu lúc 23:30:00/)).toBeTruthy();
    expect(screen.queryByText('Không phát sinh thu tiền')).toBeNull();
  });

  it('identifies missing historical payment information without inventing a method or treating a positive bill as free', async () => {
    mount({ ...empty, total: 35000, paidAmount: 35000 });
    expect(await screen.findByText('Thiếu thông tin phương thức')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Xem' }));
    const dialog = await screen.findByRole('dialog', { name: 'Chi tiết hóa đơn' });
    expect(
      await within(dialog).findByText('Bản lưu hóa đơn chưa có thông tin phương thức thu tiền.'),
    ).toBeTruthy();
    expect(within(dialog).queryByText('Tiền mặt')).toBeNull();
    expect(within(dialog).queryByText('Không phát sinh thu tiền')).toBeNull();
  });
});
