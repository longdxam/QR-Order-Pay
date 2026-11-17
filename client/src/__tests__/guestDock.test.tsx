// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { GuestDock } from '../layouts/GuestDock';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function Location() {
  return <output>{useLocation().pathname}</output>;
}
function mount(active = true, calling = false) {
  const onCallStaff = vi.fn();
  render(
    <MemoryRouter initialEntries={['/menu']}>
      <Location />
      <GuestDock
        active={active}
        receiptAvailable={false}
        giftCount={active ? 2 : 0}
        supportHref={active ? 'https://t.me/cafe_sky_cskh_bot' : null}
        calling={calling}
        onCallStaff={onCallStaff}
      />
    </MemoryRouter>,
  );
  return onCallStaff;
}
it('keeps menu, orders, staff call and AI outside More and groups only secondary destinations', () => {
  const call = mount();
  const nav = screen.getByRole('navigation');
  expect(within(nav).getAllByRole('link')).toHaveLength(3);
  expect(within(nav).getByRole('link', { name: 'Thực đơn' }).getAttribute('href')).toBe('/menu');
  expect(within(nav).getByRole('link', { name: 'AI Barista' }).getAttribute('href')).toBe('/ai');
  expect(within(nav).queryByRole('link', { name: /Tặng quà/ })).toBeNull();
  expect(within(nav).getByRole('link', { name: 'Đơn của tôi' }).getAttribute('href')).toBe(
    '/orders',
  );
  expect(within(nav).getAllByRole('button')).toHaveLength(2);
  expect(within(nav).getByRole('button', { name: 'Gọi nhân viên' })).toBeTruthy();
  fireEvent.click(within(nav).getByRole('button', { name: 'Thêm' }));
  const dialog = screen.getByRole('dialog', { name: 'Thêm chức năng' });
  expect(within(dialog).getByRole('link', { name: 'Tặng quà (2)' }).getAttribute('href')).toBe(
    '/gifts',
  );
  expect(within(dialog).queryByRole('button', { name: 'Gọi nhân viên' })).toBeNull();
  const support = within(dialog).getByRole('link', { name: 'Hỗ trợ CSKH' });
  expect(support.getAttribute('rel')).toBe('noopener noreferrer');
  expect(call).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('link', { name: 'Chọn nhạc' }));
  expect(screen.getByText('/jukebox')).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Gọi nhân viên' }));
  expect(call).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('keeps entry available before joining and omits table-only actions from More', () => {
  mount(false);
  fireEvent.click(screen.getByRole('button', { name: 'Thêm' }));
  expect(screen.queryByRole('link', { name: 'Chọn nhạc' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Gọi nhân viên' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
  fireEvent.click(screen.getByRole('button', { name: 'Vào bàn' }));
  expect(screen.getByText('/t')).toBeTruthy();
});
it('does not send another staff call while the previous one is pending', () => {
  const call = mount(true, true);
  fireEvent.click(screen.getByRole('button', { name: 'Gọi nhân viên' }));
  expect(call).not.toHaveBeenCalled();
});
it('closes More when resizing back to desktop navigation', () => {
  const listeners = new Set<() => void>();
  const media = {
    matches: false,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => media),
  );
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Thêm' }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  act(() => {
    media.matches = true;
    listeners.forEach((fn) => fn());
  });
  expect(screen.queryByRole('dialog')).toBeNull();
});
