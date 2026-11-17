// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TableDisplaySetup } from '../features/staff/TableDisplaySetup';

const mock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  api: mock,
}));
vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn(async () => 'data:image/png;base64,AA==') },
}));

const tableId = '507f1f77bcf86cd799439011';
const ok = (data: unknown) => ({ data: { success: true, data } });

function mount(admin: boolean) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TableDisplaySetup admin={admin} tableId={tableId} tableName="Bàn 1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mock.get.mockReset();
  mock.post.mockReset();
  mock.get.mockResolvedValueOnce(ok({ url: 'https://x.test/t/old' }));
  mock.get.mockResolvedValue(ok({ url: 'https://x.test/t/new' }));
  mock.post.mockResolvedValue(ok({}));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Cấp lại khóa QR', () => {
  it('admin: xác nhận rồi gọi rotate-token và nạp lại QR mới', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mount(true);
    fireEvent.click(screen.getByRole('button', { name: 'Xem QR tĩnh' }));
    const rotate = await screen.findByRole('button', { name: /Cấp lại khóa/ });
    fireEvent.click(rotate);
    await waitFor(() =>
      expect(mock.post).toHaveBeenCalledWith(`/admin/tables/${tableId}/rotate-token`),
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Link vào bàn')).toHaveProperty('value', 'https://x.test/t/new'),
    );
    expect(screen.getByRole('status').textContent).toContain(
      'QR cũ của bàn này không còn dùng được',
    );
  });

  it('staff: dùng endpoint display của nhân viên', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mount(false);
    fireEvent.click(screen.getByRole('button', { name: 'Xem QR tĩnh' }));
    fireEvent.click(await screen.findByRole('button', { name: /Cấp lại khóa/ }));
    await waitFor(() => expect(mock.post).toHaveBeenCalledWith(`/staff/tables/${tableId}/display`));
  });

  it('không gọi API khi người dùng bấm Hủy ở hộp xác nhận', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    mount(true);
    fireEvent.click(screen.getByRole('button', { name: 'Xem QR tĩnh' }));
    fireEvent.click(await screen.findByRole('button', { name: /Cấp lại khóa/ }));
    expect(mock.post).not.toHaveBeenCalled();
  });
});
