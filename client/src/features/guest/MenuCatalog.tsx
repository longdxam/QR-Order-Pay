import type { ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { vnd } from '../../lib/api';
import type { Product } from './ProductDetailModal';
import { MenuPhoto } from './MenuPhoto';
import { menuStartingPrice } from './menuStartingPrice';

export function MenuCatalog<T extends Product & { categoryId: string; isArchived: boolean }>({
  products,
  categories,
  onChoose,
  status,
}: {
  products: T[];
  categories: Array<{ _id: string; name: string }>;
  onChoose: (product: T) => void;
  status?: ReactNode;
}): JSX.Element {
  const visible = products.filter((product) => !product.isArchived);
  const groups = categories.map((category) => ({
    ...category,
    products: visible.filter((product) => product.categoryId === category._id),
  }));
  const uncategorized = visible.filter(
    (product) => !categories.some((category) => category._id === product.categoryId),
  );
  if (uncategorized.length)
    groups.push({ _id: 'other', name: 'Món khác', products: uncategorized });

  return (
    <section
      id="menu-catalog"
      className="menu-catalog"
      tabIndex={-1}
      aria-labelledby="menu-catalog-title"
    >
      <header className="menu-catalog-heading">
        <div>
          <h2 id="menu-catalog-title">Thực đơn đầy đủ</h2>
          <p>Chọn món bạn thích để tùy chỉnh theo khẩu vị.</p>
        </div>
        {!status ? <span>{visible.length} món</span> : null}
      </header>
      {status ??
        (visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">Thực đơn đang được cập nhật.</p>
        ) : (
          groups
            .filter((group) => group.products.length > 0)
            .map((group) => (
              <section key={group._id} className="menu-catalog-group" aria-label={group.name}>
                <h3>{group.name}</h3>
                <div className="menu-catalog-grid">
                  {group.products.map((product) => (
                    <button
                      key={product._id}
                      type="button"
                      className="menu-catalog-card"
                      aria-label={`Chọn món ${product.name}`}
                      disabled={!product.isAvailable}
                      onClick={() => onChoose(product)}
                    >
                      <span className="menu-catalog-photo">
                        <MenuPhoto source={product.image} />
                      </span>
                      <span className="menu-catalog-copy">
                        <span className="menu-catalog-name">{product.name}</span>
                        <span className="menu-catalog-description">{product.description}</span>
                        <span className="menu-catalog-footer">
                          <span>Từ {vnd(menuStartingPrice(product))}</span>
                          <span className="menu-catalog-action">
                            {product.isAvailable ? (
                              <Plus className="h-4 w-4" aria-hidden="true" />
                            ) : null}
                            {product.isAvailable ? 'Chọn món' : 'Tạm hết'}
                          </span>
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ))
        ))}
    </section>
  );
}
