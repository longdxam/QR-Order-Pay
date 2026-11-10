import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { vnd } from '../../lib/api';
import type { Product } from './ProductDetailModal';
import { menuImageSource } from './menuImages';
import { MenuPhoto } from './MenuPhoto';
import { menuStartingPrice } from './menuStartingPrice';

export function MenuShowcase<T extends Product & { categoryId: string }>({
  products,
  categories,
  onChoose,
  children,
  status,
}: {
  products: T[];
  categories: Array<{ _id: string; name: string }>;
  onChoose: (product: T) => void;
  children: ReactNode;
  status?: ReactNode;
}): JSX.Element {
  const [activeId, setActiveId] = useState<string | null>(null);
  const index = Math.max(
    0,
    products.findIndex((product) => product._id === activeId),
  );
  const active = products[index];
  const dotStart = Math.min(Math.max(index - 1, 1), products.length - 5);
  const indicators =
    products.length <= 6
      ? products.map((_, position) => position)
      : [0, ...Array.from({ length: 4 }, (_, offset) => dotStart + offset), products.length - 1];
  const activeCategory = categories.find((category) => category._id === active?.categoryId)?.name;
  const gesture = useRef<{ pointerId: number; x: number; y: number; productId: string } | null>(
    null,
  );
  const suppressClickUntil = useRef(0);
  function move(direction: number): void {
    if (products.length < 2) return;
    setActiveId(products[(index + direction + products.length) % products.length]!._id);
  }
  useEffect(() => {
    if (!active) return;
    for (const next of [
      products[(index - 1 + products.length) % products.length],
      products[(index + 1) % products.length],
    ]) {
      if (next?.image && next._id !== active._id) {
        const image = new Image();
        image.src = menuImageSource(next.image);
      }
    }
  }, [active, index, products]);
  return (
    <section className="menu-experience" aria-label="Thực đơn">
      <div className="menu-backdrop" aria-hidden="true" data-product-id={active?._id ?? ''}>
        {active ? (
          <MenuPhoto
            key={active._id}
            source={active.image}
            eager
            className="menu-photo menu-backdrop-photo"
          />
        ) : null}
      </div>
      <div className="menu-backdrop-shade" aria-hidden="true" />
      {active && !status ? (
        <button
          type="button"
          className="menu-picture-action"
          aria-label={`Chọn món đang xem: ${active.name}`}
          aria-disabled={!active.isAvailable}
          onClick={(event) => {
            if (performance.now() < suppressClickUntil.current) {
              event.preventDefault();
              suppressClickUntil.current = 0;
              return;
            }
            if (active.isAvailable) onChoose(active);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') suppressClickUntil.current = 0;
          }}
          onPointerDown={(event) => {
            if (event.isPrimary === false || event.button !== 0) {
              gesture.current = null;
              suppressClickUntil.current = performance.now() + 600;
              return;
            }
            suppressClickUntil.current = 0;
            gesture.current = {
              pointerId: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              productId: active._id,
            };
          }}
          onPointerMove={(event) => {
            const start = gesture.current;
            if (!start || start.pointerId !== event.pointerId) return;
            if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10)
              suppressClickUntil.current = performance.now() + 600;
          }}
          onPointerUp={(event) => {
            const start = gesture.current;
            if (!start || start.pointerId !== event.pointerId) return;
            gesture.current = null;
            const dx = event.clientX - start.x;
            const dy = event.clientY - start.y;
            if (Math.hypot(dx, dy) > 10) suppressClickUntil.current = performance.now() + 600;
            if (start.productId !== active._id) return;
            if (Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy) * 1.25) move(dx < 0 ? 1 : -1);
          }}
          onPointerCancel={() => {
            gesture.current = null;
            suppressClickUntil.current = performance.now() + 600;
          }}
        />
      ) : null}
      <div className="menu-experience-inner">
        <div className="menu-tools">{children}</div>
        {status ? (
          <div className="menu-status">
            <div className="menu-state-panel">{status}</div>
          </div>
        ) : active ? (
          <div className="menu-showcase-body">
            <div className="menu-hero-caption">
              <div id="menu-preview-info" aria-live="polite" aria-atomic="true">
                {activeCategory ? <p className="menu-preview-category">{activeCategory}</p> : null}
                <h2 className="menu-preview-name">{active.name}</h2>
                {active.description ? (
                  <p className="menu-preview-description">{active.description}</p>
                ) : null}
                <div className="menu-preview-meta">
                  <p className="menu-preview-price">
                    <span>Từ</span> {vnd(menuStartingPrice(active))}
                  </p>
                  {!active.isAvailable ? (
                    <span className="menu-preview-unavailable">Tạm hết</span>
                  ) : null}
                </div>
              </div>
              <a href="#menu-catalog" className="menu-browse">
                <ArrowDown className="h-4 w-4" aria-hidden="true" />
                <span>Thực đơn</span>
              </a>
            </div>
            <div
              className="menu-switcher"
              role="group"
              aria-label="Chuyển món"
              onKeyDown={(event) => {
                if (event.altKey || event.ctrlKey || event.metaKey) return;
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                  event.preventDefault();
                  move(event.key === 'ArrowLeft' ? -1 : 1);
                }
              }}
            >
              <button
                type="button"
                className="menu-switch-button menu-switch-previous"
                aria-label="Món trước"
                aria-controls="menu-preview-info"
                disabled={products.length < 2}
                onClick={() => move(-1)}
              >
                <ChevronLeft className="h-6 w-6" strokeWidth={1.75} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="menu-switch-button menu-switch-next"
                aria-label="Món tiếp theo"
                aria-controls="menu-preview-info"
                disabled={products.length < 2}
                onClick={() => move(1)}
              >
                <ChevronRight className="h-6 w-6" strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
            <div className="menu-indicators" role="group" aria-label="Vị trí món">
              {indicators.map((position) => (
                <button
                  key={position}
                  type="button"
                  className="menu-indicator"
                  aria-label={`Món ${position + 1} trên ${products.length}: ${products[position]!.name}`}
                  aria-current={position === index ? 'true' : undefined}
                  aria-controls="menu-preview-info"
                  onClick={() => setActiveId(products[position]!._id)}
                >
                  <span aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
