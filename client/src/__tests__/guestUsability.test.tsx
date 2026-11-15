// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../components/ui/Toast';
import { LoginPage } from '../features/auth/LoginPage';
import { ProductDetailModal } from '../features/guest/ProductDetailModal';

const mock = vi.hoisted(() => ({ post: vi.fn(), setSession: vi.fn() }));
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  api: mock,
}));
vi.mock('../features/guest/guestContext', () => ({ useGuestContext: () => null }));
vi.mock('../features/auth/useAuth', () => ({
  useAuth: (select: (state: unknown) => unknown) => select({ setSession: mock.setSession }),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});
function login() {
  render(
    <MemoryRouter>
      <ToastProvider>
        <LoginPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

it('keeps demo credentials absent by default and exposes them only with the explicit build flag', () => {
  vi.stubEnv('VITE_SHOW_DEMO_CREDENTIALS', 'false');
  login();
  expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('');
  expect((screen.getByLabelText('Mật khẩu') as HTMLInputElement).value).toBe('');
  expect(screen.queryByText(/Demo:/)).toBeNull();
  cleanup();
  vi.stubEnv('VITE_SHOW_DEMO_CREDENTIALS', 'true');
  login();
  expect((screen.getByLabelText('Email') as HTMLInputElement).value).toMatch(/@maycafe.vn$/);
  expect((screen.getByLabelText('Mật khẩu') as HTMLInputElement).value).not.toBe('');
  expect(screen.getByText(/Demo:/)).toBeTruthy();
});
it('takes a guest directly to entry even when the preview has no available variant, without trying to order', () => {
  const close = vi.fn();
  const product = {
    _id: 'p',
    name: 'Trà sữa',
    description: '',
    image: '/milk-tea.webp',
    basePrice: 35000,
    variants: [{ _id: 'v', name: 'S', price: 35000, isAvailable: false }],
    allowedOptions: { sizes: ['S'], sugarLevels: [], iceLevels: [], toppingIds: [] },
    toppingIds: [],
    tags: [],
    isAvailable: true,
  };
  render(
    <MemoryRouter initialEntries={['/menu']}>
      <ToastProvider>
        <Routes>
          <Route
            path="/menu"
            element={
              <ProductDetailModal
                product={product}
                toppings={[]}
                onClose={close}
                onAdded={() => {}}
              />
            }
          />
          <Route path="/t" element={<h1>Vào bàn bằng QR</h1>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: /Quét QR để đặt/ }));
  expect(screen.getByRole('heading', { name: 'Vào bàn bằng QR' })).toBeTruthy();
  expect(close).toHaveBeenCalledTimes(1);
  expect(mock.post).not.toHaveBeenCalled();
});
