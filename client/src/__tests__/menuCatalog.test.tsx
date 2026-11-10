// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MenuPage } from '../features/guest/MenuPage';
import type { Product } from '../features/guest/ProductDetailModal';
import { vnd } from '../lib/api';

const mock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
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
