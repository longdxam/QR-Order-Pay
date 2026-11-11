// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui/Toast';
import { AdminProducts } from '../features/admin/Products';

const mock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  api: mock,
}));
const response = (data: unknown) => ({ data: { success: true, data } });
const clients: QueryClient[] = [];
function mount() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(qc);
  render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <AdminProducts />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
afterEach(() => {
  cleanup();
  for (const qc of clients.splice(0)) qc.clear();
  vi.resetAllMocks();
});

const product = {
  _id: 'p1',
  categoryId: 'c1',
  name: 'Trà đào cam sả',
  description: 'Chua thanh',
  image: '/x.webp',
  basePrice: 39000,
  variants: [{ _id: 'v1', name: 'M', price: 39000, isAvailable: true }],
  isAvailable: true,
  isArchived: false,
  isFeatured: false,
  tags: ['best-seller'],
  ingredientMetadata: { caffeine: true, dairy: false, flavorProfile: ['chua'] },
  allowedOptions: { sizes: ['M'], sugarLevels: ['50%'], iceLevels: [], toppingIds: [] },
};

describe('AI tag suggestions in the product form', () => {
  it('suggests tags, lets Admin pick them and saves only through the product update', async () => {
    mock.get.mockImplementation(async (url: string) =>
      url === '/admin/products'
        ? response({ products: [product] })
        : response({ categories: [{ _id: 'c1', name: 'Trà', slug: 'tra', isActive: true }] }),
    );
    mock.post.mockResolvedValue(response({ mode: 'llm', tags: ['mát lạnh', 'ngày nóng'] }));
    mock.patch.mockResolvedValue(response({ product }));
    mount();

    fireEvent.click(await screen.findByRole('button', { name: /Sửa/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'AI gợi ý tag' }));
    await waitFor(() =>
      expect(mock.post).toHaveBeenCalledWith('/admin/products/ai-tag-suggestions', {
        name: 'Trà đào cam sả',
        description: 'Chua thanh',
        categoryId: 'c1',
        tags: ['best-seller'],
        flavorProfile: ['chua'],
        caffeine: true,
        dairy: false,
      }),
    );
    expect(mock.patch).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: 'Thêm tag mát lạnh' }));
    const tagInput = screen.getByPlaceholderText('best-seller, signature') as HTMLInputElement;
    expect(tagInput.value).toBe('best-seller, mát lạnh');
    expect(screen.queryByRole('button', { name: 'Thêm tag mát lạnh' })).toBeNull();
    expect(mock.patch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(mock.patch).toHaveBeenCalledTimes(1));
    expect(mock.patch.mock.calls[0]![0]).toBe('/admin/products/p1');
    expect(mock.patch.mock.calls[0]![1]).toMatchObject({ tags: ['best-seller', 'mát lạnh'] });
  });

  it('labels rule-based suggestions and handles an empty answer', async () => {
    mock.get.mockImplementation(async (url: string) =>
      url === '/admin/products' ? response({ products: [product] }) : response({ categories: [] }),
    );
    mock.post.mockResolvedValueOnce(response({ mode: 'fallback', tags: ['chua nhẹ'] }));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Sửa/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'AI gợi ý tag' }));
    expect(await screen.findByText('Theo mô tả')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Thêm tất cả' }));
    expect(await screen.findByText('Không có tag mới để gợi ý.')).toBeTruthy();
  });
});

describe('product name search', () => {
  const coffee = { ...product, _id: 'coffee', name: 'Cà phê Sữa Đá' };
  const old = { ...product, _id: 'old', name: 'Trà đào cũ', isArchived: true };
  function searchData() {
    mock.get.mockImplementation(async (url: string) =>
      response(
        url === '/admin/products' ? { products: [product, coffee, old] } : { categories: [] },
      ),
    );
  }

  it('finds names without accents or case, keeps editing the matched item and clears back to the full list', async () => {
    searchData();
    mount();
    const input = await screen.findByRole('searchbox', { name: 'Tìm món' });
    fireEvent.change(input, { target: { value: '  CA PHE  SUA DA ' } });
    expect(screen.getByText('1 / 3 món')).toBeTruthy();
    expect(screen.queryByText(product.name, { exact: true })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sửa' }));
    expect(await screen.findByRole('dialog', { name: 'Sửa: Cà phê Sữa Đá' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xóa tìm kiếm' }));
    expect(screen.getByText('3 / 3 món')).toBeTruthy();
    expect(screen.getByText(product.name, { exact: true })).toBeTruthy();
    expect(mock.post).not.toHaveBeenCalled();
    expect(mock.patch).not.toHaveBeenCalled();
    expect(mock.delete).not.toHaveBeenCalled();
  });

  it('reveals matching archived items and distinguishes no results from an empty catalog', async () => {
    searchData();
    mount();
    const input = await screen.findByRole('searchbox', { name: 'Tìm món' });
    fireEvent.change(input, { target: { value: 'TRA DAO CU' } });
    expect(screen.getByText('1 / 3 món')).toBeTruthy();
    expect(screen.getByText(old.name).closest('details')?.open).toBe(true);
    expect(screen.getByRole('button', { name: 'Khôi phục' })).toBeTruthy();
    fireEvent.change(input, { target: { value: 'xyz-no-product' } });
    expect(screen.getByText('Không tìm thấy món phù hợp.')).toBeTruthy();
    expect(screen.getByText('0 / 3 món')).toBeTruthy();
    expect(screen.queryByText(old.name)).toBeNull();
    expect(mock.post).not.toHaveBeenCalled();
  });
});
