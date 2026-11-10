// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MenuShowcase } from '../features/guest/MenuShowcase';
import { vnd } from '../lib/api';
import type { Product } from '../features/guest/ProductDetailModal';

const espresso: Product & { categoryId: string } = {
  _id: 'espresso',
  name: 'Espresso Mây',
  description: 'Espresso đậm đà, hậu chocolate, phù hợp buổi sáng.',
  image: '/espresso.jpg',
  basePrice: 35000,
  categoryId: 'coffee',
  variants: [],
  allowedOptions: { sizes: [], sugarLevels: ['50%'], iceLevels: ['normal-ice'], toppingIds: [] },
  toppingIds: [],
  tags: [],
  isAvailable: true,
};
const coconut = {
  ...espresso,
  _id: 'coconut',
  name: 'Cà phê Dừa',
  description: 'Cà phê Việt kết hợp cốt dừa béo, ít ngọt.',
  image: '/coconut.jpg',
  basePrice: 45000,
};
const categories = [{ _id: 'coffee', name: 'Cà phê' }];
const choose = vi.fn();
beforeEach(() => {
  choose.mockReset();
  vi.stubGlobal(
    'PointerEvent',
    class extends MouseEvent {
      readonly pointerId: number;
      readonly isPrimary: boolean;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
        this.isPrimary = init.isPrimary ?? true;
      }
    },
  );
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false })),
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { value: vi.fn(), configurable: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('guest menu showcase', () => {
  it('limits indicators to six and reserves the last bright dot for the actual last product', () => {
    const products = Array.from({ length: 20 }, (_, position) => ({
      ...espresso,
      _id: `product-${position}`,
      name: `Món ${position + 1}`,
    }));
    const { rerender } = render(
      <MenuShowcase products={products} categories={categories} onChoose={choose}>
        {null}
      </MenuShowcase>,
    );
    const dots = screen.getByRole('group', { name: 'Vị trí món' });
    expect(within(dots).getAllByRole('button')).toHaveLength(6);
    const last = within(dots).getByRole('button', { name: 'Món 20 trên 20: Món 20' });
    const next = screen.getByRole('button', { name: 'Món tiếp theo' });
    for (let position = 0; position < 19; position++) {
      expect(last.getAttribute('aria-current')).toBeNull();
      expect(dots.querySelectorAll('[aria-current="true"]')).toHaveLength(1);
      fireEvent.click(next);
    }
    expect(last.getAttribute('aria-current')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Món 20' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Món trước' }));
    expect(last.getAttribute('aria-current')).toBeNull();
    fireEvent.click(within(dots).getByRole('button', { name: 'Món 1 trên 20: Món 1' }));
    expect(screen.getByRole('heading', { name: 'Món 1' })).toBeTruthy();
    expect(choose).not.toHaveBeenCalled();
    rerender(
      <MenuShowcase products={products.slice(0, 3)} categories={categories} onChoose={choose}>
        {null}
      </MenuShowcase>,
    );
    expect(
      within(screen.getByRole('group', { name: 'Vị trí món' })).getAllByRole('button'),
    ).toHaveLength(3);
  });
  it('switches photo and product details with arrows and wraps in both directions without cards', () => {
    const { container } = render(
      <MenuShowcase products={[espresso, coconut]} categories={categories} onChoose={choose}>
        {null}
      </MenuShowcase>,
    );
    expect(screen.getByRole('heading', { name: espresso.name })).toBeTruthy();
    const next = screen.getByRole('button', { name: 'Món tiếp theo' });
    const previous = screen.getByRole('button', { name: 'Món trước' });
    fireEvent.click(next);
    expect(screen.getByRole('heading', { name: coconut.name })).toBeTruthy();
    expect(screen.getByText(coconut.description)).toBeTruthy();
    expect(screen.getByText(vnd(coconut.basePrice), { exact: false })).toBeTruthy();
    expect(container.querySelector('.menu-story-content')).toBeNull();
    expect(container.querySelector('.menu-backdrop img')?.getAttribute('src')).toBe('/coconut.jpg');
    expect(container.querySelectorAll('.menu-product-card')).toHaveLength(0);
    fireEvent.click(next);
    expect(screen.getByRole('heading', { name: espresso.name })).toBeTruthy();
    fireEvent.click(previous);
    expect(screen.getByRole('heading', { name: coconut.name })).toBeTruthy();
    fireEvent.keyDown(previous, { key: 'ArrowRight' });
    expect(screen.getByRole('heading', { name: espresso.name })).toBeTruthy();
    fireEvent.keyDown(next, { key: 'ArrowLeft' });
    expect(screen.getByRole('heading', { name: coconut.name })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Chọn món' })).toBeNull();
    expect(choose).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Thực đơn' }).getAttribute('href')).toBe(
      '#menu-catalog',
    );
  });
  it('resets details and photo after filtering and disables arrows for one item', () => {
    const { rerender, container } = render(
      <MenuShowcase products={[espresso, coconut]} categories={categories} onChoose={choose}>
        {null}
      </MenuShowcase>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Món tiếp theo' }));
    expect(container.querySelector('.menu-backdrop')?.getAttribute('data-product-id')).toBe(
      coconut._id,
    );
    rerender(
      <MenuShowcase products={[espresso]} categories={categories} onChoose={choose}>
        {null}
      </MenuShowcase>,
    );
    expect(container.querySelector('.menu-backdrop')?.getAttribute('data-product-id')).toBe(
      espresso._id,
    );
    expect(screen.getByRole('heading', { name: espresso.name })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Món trước' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole('button', { name: 'Món tiếp theo' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.keyDown(screen.getByRole('group', { name: 'Chuyển món' }), { key: 'ArrowRight' });
    expect(container.querySelector('.menu-backdrop')?.getAttribute('data-product-id')).toBe(
      espresso._id,
    );
  });
  it('lets guests preview an unavailable item with its availability label', () => {
    const { container } = render(
      <MenuShowcase
        products={[espresso, { ...coconut, isAvailable: false }]}
        categories={categories}
        onChoose={choose}
      >
        {null}
      </MenuShowcase>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Món tiếp theo' }));
    expect(container.querySelector('.menu-backdrop')?.getAttribute('data-product-id')).toBe(
      coconut._id,
    );
    expect(screen.getByText('Tạm hết')).toBeTruthy();
    expect(screen.getByText(coconut.description)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Chọn món' })).toBeNull();
    const photo = screen.getByRole('button', { name: `Chọn món đang xem: ${coconut.name}` });
    expect(photo.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(photo);
    expect(choose).not.toHaveBeenCalled();
  });
  it('handles empty and loading catalogs without exposing unusable controls', () => {
    const { container, rerender } = render(
      <MenuShowcase products={[]} categories={categories} onChoose={choose}>
        {null}
      </MenuShowcase>,
    );
    expect(screen.queryByRole('group', { name: 'Chuyển món' })).toBeNull();
    expect(container.querySelector('.menu-backdrop img')).toBeNull();
    rerender(
      <MenuShowcase
        products={[]}
        categories={categories}
        onChoose={choose}
        status={<p role="status">Đang tải</p>}
      >
        {null}
      </MenuShowcase>,
    );
    expect(screen.getByRole('status').textContent).toBe('Đang tải');
    expect(screen.queryByRole('group', { name: 'Chuyển món' })).toBeNull();
    expect(container.querySelector('.menu-picture-action')).toBeNull();
  });
  it('swipes both ways without opening a modal and chooses the current item only on a tap', () => {
    render(
      <MenuShowcase products={[espresso, coconut]} categories={categories} onChoose={choose}>
        {null}
      </MenuShowcase>,
    );
    const photo = screen.getByRole('button', { name: `Chọn món đang xem: ${espresso.name}` });
    fireEvent.pointerDown(photo, { clientX: 240, clientY: 160, pointerId: 1 });
    fireEvent.pointerUp(photo, { clientX: 100, clientY: 165, pointerId: 1 });
    fireEvent.click(photo);
    expect(screen.getByRole('heading', { name: coconut.name })).toBeTruthy();
    expect(choose).not.toHaveBeenCalled();
    fireEvent.pointerDown(photo, { clientX: 100, clientY: 160, pointerId: 2 });
    fireEvent.pointerUp(photo, { clientX: 240, clientY: 165, pointerId: 2 });
    fireEvent.click(photo);
    expect(screen.getByRole('heading', { name: espresso.name })).toBeTruthy();
    expect(choose).not.toHaveBeenCalled();
    fireEvent.pointerDown(photo, { clientX: 150, clientY: 160, pointerId: 3 });
    fireEvent.pointerUp(photo, { clientX: 152, clientY: 161, pointerId: 3 });
    fireEvent.click(photo);
    expect(choose).toHaveBeenCalledExactlyOnceWith(espresso);
  });
  it('ignores vertical scrolling, cancelled gestures and short drags without choosing or switching', () => {
    render(
      <MenuShowcase products={[espresso, coconut]} categories={categories} onChoose={choose}>
        {null}
      </MenuShowcase>,
    );
    const photo = screen.getByRole('button', { name: `Chọn món đang xem: ${espresso.name}` });
    fireEvent.pointerDown(photo, { clientX: 150, clientY: 100 });
    fireEvent.pointerMove(photo, { clientX: 152, clientY: 180 });
    fireEvent.pointerUp(photo, { clientX: 154, clientY: 220 });
    fireEvent.click(photo);
    fireEvent.pointerDown(photo, { clientX: 150, clientY: 100 });
    fireEvent.pointerCancel(photo);
    fireEvent.click(photo);
    fireEvent.pointerDown(photo, { clientX: 150, clientY: 100 });
    fireEvent.pointerUp(photo, { clientX: 130, clientY: 102 });
    fireEvent.click(photo);
    expect(screen.getByRole('heading', { name: espresso.name })).toBeTruthy();
    expect(choose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('link', { name: 'Thực đơn' }));
    expect(choose).not.toHaveBeenCalled();
  });
});
