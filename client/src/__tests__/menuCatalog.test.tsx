// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MenuPage } from '../features/guest/MenuPage';
import type { Product } from '../features/guest/ProductDetailModal';
import { vnd } from '../lib/api';

const mock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
const scrollIntoView = vi.fn();
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  api: mock,
}));
vi.mock('../features/ai/AISheet', () => ({ AISheet: () => null }));
vi.mock('../features/guest/ProductDetailModal', () => ({
  ProductDetailModal: ({ product }: { product: Product | null }) =>
    product ? <div role="dialog" aria-label={product.name} /> : null,
}));

const coffee = {
  _id: 'coffee',
  categoryId: 'coffee-category',
  name: 'Cà phê sữa',
  description: 'Cà phê và sữa.',
  image: '/coffee.jpg',
  basePrice: 99000,
  variants: [
    { _id: 'small', name: 'S', price: 30000, isAvailable: false },
    { _id: 'medium', name: 'M', price: 40000, isAvailable: true },
  ],
  allowedOptions: { sizes: ['S', 'M'], sugarLevels: [], iceLevels: [], toppingIds: [] },
  toppingIds: [],
  tags: [],
  isAvailable: true,
  isArchived: false,
};
const cake = {
  ...coffee,
  _id: 'cake',
  categoryId: 'cake-category',
  name: 'Bánh Croissant',
  image: '/cake.jpg',
};
const unavailable = { ...coffee, _id: 'sold-out', name: 'Cà phê hết hàng', isAvailable: false };
let queryClient: QueryClient;

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false })),
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { value: vi.fn(), configurable: true });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    value: scrollIntoView,
    configurable: true,
  });
  mock.get.mockResolvedValue({
    data: {
      success: true,
      data: {
        products: [coffee, cake, unavailable, { ...coffee, _id: 'archived', isArchived: true }],
        categories: [
          { _id: 'coffee-category', name: 'Cà phê' },
          { _id: 'cake-category', name: 'Bánh ngọt' },
        ],
        toppings: [],
      },
    },
  });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
function mount() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MenuPage />
    </QueryClientProvider>,
  );
}

it('links to the full catalog below the preview, keeps all published items when filtering, and opens the chosen item', async () => {
  const { container } = mount();
  const cakeButton = await screen.findByRole('button', { name: 'Chọn món Bánh Croissant' });
  const catalog = screen.getByRole('region', { name: 'Thực đơn đầy đủ' });
  expect(catalog.id).toBe('menu-catalog');
  expect(container.querySelector('.menu-experience')?.nextElementSibling).toBe(catalog);
  expect(container.querySelector('.menu-story-content')).toBeNull();
  expect(screen.getByRole('link', { name: 'Thực đơn' }).getAttribute('href')).toBe('#menu-catalog');
  expect(within(catalog).getAllByRole('button')).toHaveLength(3);
  fireEvent.click(screen.getByRole('button', { name: 'Bánh ngọt' }));
  expect(container.querySelectorAll('.menu-product-card')).toHaveLength(0);
  expect(screen.getByRole('heading', { name: cake.name })).toBeTruthy();
  expect(
    (screen.getByRole('button', { name: 'Món tiếp theo' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(within(catalog).getAllByRole('button')).toHaveLength(3);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: `Chọn món đang xem: ${cake.name}` }));
  expect(screen.getByRole('dialog', { name: cake.name })).toBeTruthy();
  fireEvent.click(cakeButton);
  expect(screen.getByRole('dialog', { name: cake.name })).toBeTruthy();
  expect(mock.post).not.toHaveBeenCalled();
});

it('shows the cheapest available size and prevents choosing unavailable catalog items', async () => {
  mount();
  const button = await screen.findByRole('button', { name: 'Chọn món Cà phê sữa' });
  expect(within(button).getByText(`Từ ${vnd(40000)}`)).toBeTruthy();
  expect(button.querySelector('img')?.getAttribute('src')).toBe(coffee.image);
  const soldOut = screen.getByRole('button', { name: 'Chọn món Cà phê hết hàng' });
  expect((soldOut as HTMLButtonElement).disabled).toBe(true);
  expect(within(soldOut).getByText('Tạm hết')).toBeTruthy();
  fireEvent.click(soldOut);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(mock.post).not.toHaveBeenCalled();
});

function searchResponse(ids: string[]) {
  return {
    data: {
      data: {
        items: ids.map((productId) => ({ productId })),
        message: ids.length
          ? 'Tìm thấy món phù hợp. Giá áp dụng cho một món với cấu hình khả dụng rẻ nhất.'
          : 'Không có món khớp từ khóa.',
        intent: {
          requirements: {
            includedGroups: [],
            excludedGroups: [],
            budget: null,
            noCaffeine: false,
            noDairy: false,
          },
          preferences: { lowSugar: false, flavors: [] },
        },
      },
    },
  };
}

function submitSearch(text: string) {
  fireEvent.change(screen.getByRole('searchbox', { name: 'Tìm món' }), { target: { value: text } });
  fireEvent.submit(screen.getByRole('search', { name: 'Tìm món trong thực đơn' }));
}

it('submits to the catalog, displays matching products across categories, and restores the full menu', async () => {
  mock.post.mockResolvedValue(searchResponse(['cake', 'archived']));
  mount();
  await screen.findByRole('button', { name: 'Chọn món Bánh Croissant' });
  fireEvent.click(screen.getByRole('button', { name: 'Cà phê' }));
  submitSearch('croissant');
  const results = await screen.findByRole('region', { name: 'Kết quả tìm kiếm' });
  expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  expect(document.activeElement).toBe(results);
  await waitFor(() =>
    expect(within(results).getAllByRole('button', { name: /^Chọn món / })).toHaveLength(1),
  );
  expect(within(results).getByRole('button', { name: 'Chọn món Bánh Croissant' })).toBeTruthy();
  expect(within(results).getByText('Tìm thấy 1 món phù hợp.')).toBeTruthy();
  expect(within(results).queryByText(/Giá áp dụng cho một món/)).toBeNull();
  expect(within(results).queryByText('Đã hiểu:')).toBeNull();
  expect(within(results).queryByText('từ khóa tự do')).toBeNull();
  expect(
    within(results).queryByText('Sửa câu tìm kiếm hoặc bấm nút bộ lọc để thay đổi.'),
  ).toBeNull();
  expect(within(results).queryByRole('button', { name: 'Chọn món Cà phê sữa' })).toBeNull();
  expect(mock.post).toHaveBeenCalledWith(
    '/menu/search',
    { query: 'croissant' },
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(within(results).getByRole('button', { name: 'Chọn món Bánh Croissant' }));
  expect(screen.getByRole('dialog', { name: cake.name })).toBeTruthy();
  fireEvent.click(within(results).getByRole('button', { name: 'Xem toàn bộ thực đơn' }));
  const full = screen.getByRole('region', { name: 'Thực đơn đầy đủ' });
  expect(within(full).getAllByRole('button')).toHaveLength(3);
  expect((screen.getByRole('searchbox', { name: 'Tìm món' }) as HTMLInputElement).value).toBe('');
});

it('keeps an empty search result empty instead of showing the full catalog', async () => {
  mock.post.mockResolvedValue(searchResponse([]));
  mount();
  await screen.findByRole('button', { name: 'Chọn món Bánh Croissant' });
  submitSearch('không có món này');
  const results = screen.getByRole('region', { name: 'Kết quả tìm kiếm' });
  await within(results).findByRole('heading', { name: 'Không có món phù hợp' });
  expect(within(results).queryAllByRole('button', { name: /^Chọn món / })).toHaveLength(0);
  expect(within(results).getByText('Không có món khớp từ khóa.')).toBeTruthy();
});

it('shows loading and ignores late responses for an older query, including after clearing', async () => {
  let finishFirst!: (value: ReturnType<typeof searchResponse>) => void;
  let finishSecond!: (value: ReturnType<typeof searchResponse>) => void;
  mock.post.mockImplementation(
    (_path, body: { query: string }) =>
      new Promise((resolve) => {
        if (body.query === 'cafe') finishFirst = resolve;
        else finishSecond = resolve;
      }),
  );
  mount();
  await screen.findByRole('button', { name: 'Chọn món Bánh Croissant' });
  submitSearch('cafe');
  await waitFor(() => expect(finishFirst).toBeTypeOf('function'));
  submitSearch('croissant');
  const results = screen.getByRole('region', { name: 'Kết quả tìm kiếm' });
  expect(within(results).getByLabelText('Đang tải thực đơn')).toBeTruthy();
  await waitFor(() => expect(finishSecond).toBeTypeOf('function'));
  finishSecond(searchResponse(['cake']));
  await within(results).findByRole('button', { name: 'Chọn món Bánh Croissant' });
  finishFirst(searchResponse(['coffee']));
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));
  expect(within(results).queryByRole('button', { name: 'Chọn món Cà phê sữa' })).toBeNull();
  fireEvent.click(within(results).getByRole('button', { name: 'Xem toàn bộ thực đơn' }));
  expect(
    within(screen.getByRole('region', { name: 'Thực đơn đầy đủ' })).getAllByRole('button'),
  ).toHaveLength(3);
});

it('shows search failures and retries inside the results catalog', async () => {
  mock.post
    .mockRejectedValueOnce(new Error('Không tải được kết quả'))
    .mockResolvedValue(searchResponse(['cake']));
  mount();
  await screen.findByRole('button', { name: 'Chọn món Bánh Croissant' });
  submitSearch('croissant');
  const results = screen.getByRole('region', { name: 'Kết quả tìm kiếm' });
  await within(results).findByText('Không tải được kết quả');
  expect(within(results).queryAllByRole('button', { name: /^Chọn món / })).toHaveLength(0);
  fireEvent.click(within(results).getByRole('button', { name: 'Thử lại' }));
  await within(results).findByRole('button', { name: 'Chọn món Bánh Croissant' });
});
