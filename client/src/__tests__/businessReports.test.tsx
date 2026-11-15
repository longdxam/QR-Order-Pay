// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui/Toast';
import { AdminDashboard } from '../features/admin/Dashboard';
import type { ReactNode } from 'react';
import type { DashboardOverview } from '@may-cafe/contracts';
import { BusinessReports } from '../features/admin/BusinessReports';
const report = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('../lib/reportJobs', () => ({ createOverviewReport: report.run }));
vi.mock('recharts', () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Bar: Box,
    BarChart: Box,
    CartesianGrid: Box,
    Cell: Box,
    ReferenceLine: Box,
    ResponsiveContainer: Box,
    Tooltip: Box,
    XAxis: Box,
    YAxis: Box,
  };
});
afterEach(() => {
  cleanup();
  report.run.mockReset();
});
const empty: DashboardOverview = {
  totalRevenue: 0,
  grossCollected: 0,
  totalRefunded: 0,
  adjustmentAmount: 0,
  orderCount: 0,
  averageOrderValue: 0,
  topProducts: [],
  revenueByDay: [],
  revenueByHour: [],
  hasFinancialData: false,
  ordersCreated: 0,
  cancelledOrders: 0,
  cancellationRate: null,
  categorySales: [],
  revenueByMethod: [],
  ordersByHour: [],
  comparison: {
    from: '2026-10-01',
    to: '2026-10-03',
    totalRevenue: 0,
    orderCount: 0,
    ordersCreated: 0,
    cancelledOrders: 0,
    cancellationRate: null,
  },
};
it('shows empty states instead of implying an empty period is a measured zero or a zero cancellation rate', () => {
  render(<BusinessReports data={empty} />);
  expect(screen.getAllByRole('status')).toHaveLength(5);
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.getByText(/kỳ trước 0đ, không tính %/)).toBeTruthy();
  expect(screen.getByText('Chưa có đơn')).toBeTruthy();
});
it('keeps zero-net activity visible, explains negative bars and distinguishes category item value from financial net', () => {
  render(
    <BusinessReports
      data={{
        ...empty,
        hasFinancialData: true,
        grossCollected: 90000,
        totalRefunded: 90000,
        ordersCreated: 2,
        cancelledOrders: 1,
        cancellationRate: 0.5,
        revenueByDay: [
          { date: '2026-10-26', revenue: 90000, orders: 1 },
          { date: '2026-10-27', revenue: -90000, orders: 0 },
        ],
        categorySales: [{ categoryId: 'coffee', name: 'Cà phê', quantity: 2, revenue: 100000 }],
        revenueByMethod: [
          { method: 'CASH', collected: 0, refunded: 90000, adjustment: 0, revenue: -90000 },
        ],
      }}
    />,
  );
  expect(screen.getAllByRole('img')).toHaveLength(3);
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByText('50%')).toBeTruthy();
  expect(screen.getByText(/Đỏ: ròng âm do hoàn/)).toBeTruthy();
  expect(screen.getByText('Tiền mặt')).toBeTruthy();
  expect(screen.getByText(/Không cộng số này vào thực thu/)).toBeTruthy();
});
it('requests the selected date range and replaces charts with empty states when the range has no data', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  report.run.mockImplementation(async (range: { from: string; to: string }) =>
    range.from === '2026-12-01'
      ? empty
      : { ...empty, hasFinancialData: true, grossCollected: 10000, totalRevenue: 10000 },
  );
  try {
    render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <ToastProvider>
            <AdminDashboard />
          </ToastProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    await screen.findByLabelText('Đến ngày');
    fireEvent.change(screen.getByLabelText('Đến ngày'), { target: { value: '2026-12-02' } });
    await screen.findByLabelText('Từ ngày');
    fireEvent.change(screen.getByLabelText('Từ ngày'), { target: { value: '2026-12-01' } });
    await waitFor(() =>
      expect(report.run).toHaveBeenCalledWith(
        { from: '2026-12-01', to: '2026-12-02' },
        'json',
        expect.any(AbortSignal),
      ),
    );
    await waitFor(() => expect(screen.getAllByRole('status')).toHaveLength(5));
    expect(screen.getByRole('heading', { name: 'Từ 01/12/2026 đến 02/12/2026' })).toBeTruthy();
  } finally {
    client.clear();
  }
});
