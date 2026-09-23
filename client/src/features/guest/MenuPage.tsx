import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Sparkles, Coffee, SlidersHorizontal, X } from 'lucide-react';
import type { MenuSearchResponse } from '@may-cafe/contracts';
import { api, getErrorMessage, unwrap, vnd } from '../../lib/api';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Skeleton';
import { EmptyState, ErrorState } from '../../components/ui/EmptyState';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';
import { Button } from '../../components/ui/Button';
import { ProductDetailModal } from './ProductDetailModal';
import { AISheet } from '../ai/AISheet';

interface Product {
  _id: string;
  name: string;
  description: string;
  image: string;
  basePrice: number;
  categoryId: string;
  isArchived: boolean;
  variants: Array<{ _id: string; name: string; price: number; isAvailable?: boolean }>;
  allowedOptions: {
    sizes: string[];
    sugarLevels: string[];
    iceLevels: string[];
    toppingIds: string[];
  };
  toppingIds: string[];
  tags: string[];
  ingredientMetadata: { caffeine: boolean; dairy: boolean; flavorProfile: string[] };
  isAvailable: boolean;
  isFeatured: boolean;
}

interface Category {
  _id: string;
  name: string;
  slug: string;
  sortOrder: number;
}

interface Topping {
  _id: string;
  name: string;
  price: number;
  isAvailable: boolean;
}

interface MenuResponse {
  categories: Category[];
  products: Product[];
  toppings: Topping[];
}

export function MenuPage(): JSX.Element {
  useDocumentTitle('Menu');
  const [query, setQuery] = useState('');
  const [activeCat, setActiveCat] = useState<string | 'all'>('all');
  const [selected, setSelected] = useState<Product | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [manualFilters, setManualFilters] = useState(false);
  const [maxBudget, setMaxBudget] = useState('');
  const [noCaffeine, setNoCaffeine] = useState(false);
  const [noDairy, setNoDairy] = useState(false);

  const searchText = query.trim() || (manualFilters ? 'món' : '');
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(searchText), 350);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  const menuQuery = useQuery({
    queryKey: ['menu'],
    queryFn: async () => unwrap(await api.get<MenuResponse>('/categories')),
  });

  const searchQuery = useQuery({
    queryKey: ['menu-search', debouncedQuery, manualFilters, maxBudget, noCaffeine, noDairy],
    queryFn: async ({ signal }) => unwrap<MenuSearchResponse>(await api.post('/menu/search', {
      query: debouncedQuery,
      ...(manualFilters ? {
        filters: {
          maxBudget: maxBudget ? Number(maxBudget) : null,
          noCaffeine,
          noDairy,
        },
      } : {}),
    }, { signal })),
    enabled: debouncedQuery.length > 0,
    staleTime: 30_000,
  });

  const searchActive = searchText.length > 0;

  const filtered = useMemo(() => {
    if (!menuQuery.data) return [];
    const byId = new Map(menuQuery.data.products.map((product) => [product._id, product]));
    const list = searchActive
      ? (searchQuery.data?.items.map((item) => byId.get(item.productId)).filter((product): product is Product => !!product) ?? [])
      : menuQuery.data.products.filter((p) => !p.isArchived);
    return list.filter((p) => {
      const inCat = activeCat === 'all' || p.categoryId === activeCat;
      return inCat;
    });
  }, [menuQuery.data, activeCat, searchActive, searchQuery.data]);

  const featured = useMemo(() => filtered.filter((p) => p.isFeatured).slice(0, 3), [filtered]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold">Thực đơn hôm nay</h1>
          <p className="text-sm text-muted-foreground">Chọn món bạn thích, tùy chỉnh size, đường, đá và gọi ngay.</p>
        </div>
        <Button variant="accent" onClick={() => setAiOpen(true)}>
          <Sparkles className="h-4 w-4" /> Hỏi AI Barista
        </Button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Thử: cà phê không sữa dưới 40 nghìn"
            className="pl-9"
          />
          {query ? <button aria-label="Xóa tìm kiếm" onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"><X className="h-4 w-4" /></button> : null}
        </div>
        <Button variant="outline" onClick={() => setManualFilters((value) => !value)}>
          <SlidersHorizontal className="h-4 w-4" /> {manualFilters ? 'Dùng câu tìm kiếm' : 'Chỉnh bộ lọc'}
        </Button>
      </div>

      {manualFilters ? (
        <div className="card grid grid-cols-1 gap-3 p-3 sm:grid-cols-3">
          <label className="text-sm">Ngân sách tối đa mỗi món
            <Input type="number" min="1000" step="1000" value={maxBudget} onChange={(event) => setMaxBudget(event.target.value)} placeholder="Ví dụ 40000" className="mt-1" />
          </label>
          <label className="flex items-center gap-2 self-end rounded-xl bg-muted p-2 text-sm"><input type="checkbox" checked={noCaffeine} onChange={(event) => setNoCaffeine(event.target.checked)} /> Không caffeine</label>
          <label className="flex items-center gap-2 self-end rounded-xl bg-muted p-2 text-sm"><input type="checkbox" checked={noDairy} onChange={(event) => setNoDairy(event.target.checked)} /> Không sữa</label>
          <p className="text-xs text-muted-foreground sm:col-span-3">Bộ lọc thủ công thay thế các điều kiện ngân sách/caffeine/sữa được hiểu từ câu tìm kiếm. Giá là cho một món với size khả dụng rẻ nhất.</p>
        </div>
      ) : null}

      {searchActive ? (
        <div className="space-y-2 rounded-2xl bg-muted p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="warning">Tìm theo menu</Badge>
            {searchQuery.isFetching ? <span className="text-muted-foreground">Đang hiểu câu tìm kiếm…</span> : null}
            {searchQuery.data ? <span>{searchQuery.data.message}</span> : null}
          </div>
          {searchQuery.data ? <UnderstoodFilters intent={searchQuery.data.intent} /> : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Chip active={activeCat === 'all'} onClick={() => setActiveCat('all')}>
          Tất cả
        </Chip>
        {menuQuery.data?.categories.map((c) => (
          <Chip key={c._id} active={activeCat === c._id} onClick={() => setActiveCat(c._id)}>
            {c.name}
          </Chip>
        ))}
      </div>

      {featured.length > 0 && !query && activeCat === 'all' ? (
        <section>
          <h2 className="font-display text-lg font-semibold mb-2">Đề xuất hôm nay</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {featured.map((p) => (
              <FeaturedCard key={p._id} product={p} onClick={() => setSelected(p)} />
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="font-display text-lg font-semibold mb-2">Thực đơn</h2>
        {menuQuery.isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-44" />
            ))}
          </div>
        ) : menuQuery.isError ? (
          <ErrorState message={getErrorMessage(menuQuery.error)} onRetry={() => menuQuery.refetch()} />
        ) : searchActive && searchQuery.isError ? (
          <ErrorState message={getErrorMessage(searchQuery.error)} onRetry={() => searchQuery.refetch()} />
        ) : searchActive && (searchQuery.isLoading || debouncedQuery !== searchText) ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-44" />)}</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            title="Không có món phù hợp"
            description={searchQuery.data?.message ?? 'Thử bỏ bộ lọc hoặc đổi từ khóa khác.'}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((p) => (
              <ProductCard key={p._id} product={p} onClick={() => setSelected(p)} />
            ))}
          </div>
        )}
      </section>

      <ProductDetailModal
        product={selected}
        toppings={menuQuery.data?.toppings ?? []}
        onClose={() => setSelected(null)}
        onAdded={() => {
          setSelected(null);
        }}
      />

      <AISheet open={aiOpen} onOpenChange={setAiOpen} products={menuQuery.data?.products ?? []} toppings={menuQuery.data?.toppings ?? []} />
    </div>
  );
}

function UnderstoodFilters({ intent }: { intent: MenuSearchResponse['intent'] }): JSX.Element {
  const labels: string[] = [];
  if (intent.requirements.noCaffeine) labels.push('Không caffeine');
  if (intent.requirements.noDairy) labels.push('Không sữa');
  for (const group of intent.requirements.includedGroups) labels.push(({ coffee: 'Nhóm cà phê', tea: 'Nhóm trà', fruit: 'Trái cây' })[group]);
  for (const group of intent.requirements.excludedGroups) labels.push(`Loại ${{ coffee: 'cà phê', tea: 'trà', fruit: 'trái cây' }[group]}`);
  if (intent.requirements.budget) labels.push(`${intent.requirements.budget.inclusive ? 'Không quá' : 'Dưới'} ${vnd(intent.requirements.budget.maxVnd)}/món`);
  if (intent.preferences.lowSugar) labels.push('Ưu tiên ít đường');
  return <div className="flex flex-wrap items-center gap-1"><span className="text-xs text-muted-foreground">Đã hiểu:</span>{labels.length > 0 ? labels.map((label) => <Badge key={label} tone="info">{label}</Badge>) : <span className="text-xs text-muted-foreground">từ khóa tự do</span>}<span className="text-xs text-muted-foreground">· sửa câu hoặc bấm “Chỉnh bộ lọc” để thay đổi.</span></div>;
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }): JSX.Element {
  return (
    <button
      className={`rounded-full px-3 py-1.5 text-xs font-medium transition border ${
        active
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-card text-foreground/80 border-foreground/10 hover:bg-muted'
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function FeaturedCard({ product, onClick }: { product: Product; onClick: () => void }): JSX.Element {
  return (
    <button
      className="card overflow-hidden text-left hover:shadow-md transition flex sm:flex-col"
      onClick={onClick}
    >
      <img
        src={product.image}
        alt={product.name}
        className="h-32 w-32 sm:w-full sm:h-36 object-cover"
        loading="lazy"
      />
      <div className="p-3 flex-1">
        <p className="text-xs text-accent font-semibold uppercase tracking-wider">Signature</p>
        <h3 className="mt-1 font-display text-base font-semibold">{product.name}</h3>
        <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{product.description}</p>
        <p className="mt-2 font-semibold">Từ {vnd(product.basePrice)}</p>
      </div>
    </button>
  );
}

function ProductCard({ product, onClick }: { product: Product; onClick: () => void }): JSX.Element {
  return (
    <button className="card overflow-hidden text-left hover:shadow-md transition" onClick={onClick}>
      <div className="relative h-36 bg-muted">
        <img src={product.image} alt={product.name} className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
        {!product.isAvailable ? (
          <span className="absolute top-2 left-2">
            <Badge tone="danger">Tạm hết</Badge>
          </span>
        ) : product.isFeatured ? (
          <span className="absolute top-2 left-2">
            <Badge tone="info">
              <Coffee className="h-3 w-3" /> Signature
            </Badge>
          </span>
        ) : null}
      </div>
      <div className="p-3">
        <h3 className="font-display text-base font-semibold line-clamp-1">{product.name}</h3>
        <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{product.description}</p>
        <p className="mt-2 font-semibold">Từ {vnd(product.basePrice)}</p>
      </div>
    </button>
  );
}
