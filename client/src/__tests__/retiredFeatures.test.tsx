// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';
import { AISheet } from '../features/ai/AISheet';
import { useCart, type CartItem } from '../store/cart';
import { ToastProvider } from '../components/ui/Toast';

const mock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  api: mock,
}));
vi.mock('../lib/socket', () => ({
  connectGuestSocket: () => ({ connected: false }),
  disconnectSocket: vi.fn(),
  useSocketEvent: vi.fn(),
}));
vi.mock('../features/auth/useAuth', () => ({ useAuth: () => ({ user: null, accessToken: null }) }));
const response = (data: unknown) => ({ data: { success: true, data } });
let qc: QueryClient;
function mount(element: JSX.Element, path = '/t') {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>{element}</ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false })),
  );
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  useCart.getState().resetSession();
  mock.get.mockImplementation(async (url: string) =>
    response(url === '/table-sessions/current' ? { active: false } : { member: null, items: [] }),
  );
});
afterEach(() => {
  cleanup();
  qc?.clear();
  vi.clearAllMocks();
});

describe('removed features in the client', () => {
  it.each([
    '/game',
    '/pickup',
    '/pickup/orders',
    '/pickup/member',
    '/staff/pickups',
    '/admin/pickups',
    '/admin/freestyle',
    '/admin/insights',
  ])('routes obsolete URL %s to the portal home without querying removed APIs', async (path) => {
    mount(<App />, path);
    await screen.findByRole('heading', { name: /Quét QR/ });
    expect(screen.queryByText(/Đặt mang đi/)).toBeNull();
    expect(
      mock.get.mock.calls.some(([url]) => /pickup|freestyle|insights|companions|game/.test(url)),
    ).toBe(false);
  });

  it('keeps menu AI recommendations and removes Freestyle selection', async () => {
    mock.post.mockResolvedValue(
      response({ mode: 'fallback', message: 'Chọn từ thực đơn', recommendations: [] }),
    );
    mount(<AISheet open onOpenChange={() => {}} products={[]} onAdd={() => {}} />);
    expect(screen.queryByRole('tab', { name: 'Freestyle' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hỏi AI' }));
    await screen.findByText('Chọn từ thực đơn');
    expect(mock.post).toHaveBeenCalledExactlyOnceWith(
      '/ai/recommendations',
      expect.objectContaining({ prompt: expect.any(String) }),
    );
  });

  it('migrates old persisted carts by removing only off-menu items and preserving table identity and catalog items', async () => {
    const catalog = {
      clientId: 'catalog',
      productId: 'product',
      name: 'Trà',
      quantity: 1,
      unitPrice: 30000,
    } as CartItem;
    localStorage.setItem(
      'mc-cart',
      JSON.stringify({
        version: 0,
        state: {
          tableSessionId: 'session',
          participantId: 'guest',
          items: [
            catalog,
            {
              ...catalog,
              clientId: 'off-menu',
              freestyleToken: 'old-token',
              freestyle: { name: 'Old recipe' },
            },
          ],
        },
      }),
    );
    await useCart.persist.rehydrate();
    await waitFor(() => expect(useCart.getState().items).toEqual([catalog]));
    expect(useCart.getState().tableSessionId).toBe('session');
    expect(useCart.getState().participantId).toBe('guest');
  });
});
