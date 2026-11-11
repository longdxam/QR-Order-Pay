import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2, ArchiveRestore, Sparkles, Search, X } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Skeleton } from '../../components/ui/Skeleton';
import { ErrorState } from '../../components/ui/EmptyState';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';
import { api, getErrorMessage, unwrap, vnd } from '../../lib/api';
import { useToast } from '../../components/ui/useToast';

interface Variant {
  _id?: string;
  name: string;
  price: number;
  isAvailable: boolean;
}

interface AdminProduct {
  _id: string;
  categoryId: string;
  name: string;
  description: string;
  image: string;
  basePrice: number;
  variants: Variant[];
  isAvailable: boolean;
  isArchived: boolean;
  isFeatured: boolean;
  tags: string[];
  toppingIds?: string[];
  ingredientMetadata?: {
    caffeine: boolean;
    dairy: boolean;
    flavorProfile: string[];
    allergens?: string[];
    notes?: string;
  };
  allowedOptions?: {
    sizes?: string[];
    sugarLevels?: string[];
    iceLevels?: string[];
    toppingIds?: string[];
  };
}

interface Category {
  _id: string;
  name: string;
  slug: string;
  isActive: boolean;
}

interface FormState {
  name: string;
  description: string;
  image: string;
  basePrice: string;
  variants: Variant[];
  isAvailable: boolean;
  isFeatured: boolean;
  isArchived: boolean;
  categoryId: string;
  tagInput: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  description: '',
  image: '',
  basePrice: '35000',
  variants: [{ name: 'M', price: 35000, isAvailable: true }],
  isAvailable: true,
  isFeatured: false,
  isArchived: false,
  categoryId: '',
  tagInput: '',
};

export function AdminProducts(): JSX.Element {
  useDocumentTitle('Quản lý món');
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState<AdminProduct | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [deleting, setDeleting] = useState<AdminProduct | null>(null);
  const [tagSuggestions, setTagSuggestions] = useState<TagSuggestions | null>(null);
  const [search, setSearch] = useState('');

  const productsQuery = useQuery({
    queryKey: ['admin-products'],
    queryFn: async () => unwrap(await api.get<{ products: AdminProduct[] }>('/admin/products')),
  });
  const categoriesQuery = useQuery({
    queryKey: ['admin-categories'],
    queryFn: async () => unwrap(await api.get<{ categories: Category[] }>('/admin/categories')),
  });

  useEffect(() => {
    setTagSuggestions(null);
    if (editing === 'new') {
      setForm({ ...EMPTY_FORM, categoryId: categoriesQuery.data?.categories[0]?._id ?? '' });
    } else if (editing) {
      const p = editing;
      setForm({
        name: p.name,
        description: p.description,
        image: p.image,
        basePrice: String(p.basePrice),
        variants: p.variants.length
          ? p.variants
          : [{ name: 'M', price: p.basePrice, isAvailable: true }],
        isAvailable: p.isAvailable,
        isFeatured: p.isFeatured,
        isArchived: p.isArchived,
        categoryId: p.categoryId,
        tagInput: p.tags.join(', '),
      });
    }
  }, [editing, categoriesQuery.data]);

  const save = useMutation({
    mutationFn: async () => {
      const tags = parseTags(form.tagInput);
      const payload = {
        name: form.name,
        description: form.description,
        image: form.image,
        basePrice: Number(form.basePrice),
        variants: form.variants.map((v) => ({
          ...(v._id ? { _id: v._id } : {}),
          name: v.name,
          price: Number(v.price),
          isAvailable: v.isAvailable,
        })),
        isAvailable: form.isAvailable,
        isFeatured: form.isFeatured,
        isArchived: form.isArchived,
        tags,
        categoryId: form.categoryId || undefined,
        allowedOptions: {
          sizes: Array.from(new Set(form.variants.map((v) => v.name))),
          sugarLevels:
            editing && editing !== 'new'
              ? (editing.allowedOptions?.sugarLevels ?? [])
              : ['0%', '30%', '50%', '70%', '100%'],
          iceLevels:
            editing && editing !== 'new'
              ? (editing.allowedOptions?.iceLevels ?? [])
              : ['no-ice', 'less-ice', 'normal-ice'],
          toppingIds:
            editing && editing !== 'new' ? (editing.allowedOptions?.toppingIds ?? []) : [],
        },
        toppingIds: editing && editing !== 'new' ? (editing.toppingIds ?? []) : [],
        ingredientMetadata:
          editing && editing !== 'new'
            ? editing.ingredientMetadata
            : {
                caffeine: false,
                dairy: false,
                flavorProfile: [],
                allergens: [],
                notes: '',
              },
      };
      if (editing === 'new') {
        return unwrap(await api.post('/admin/products', payload));
      }
      if (!editing) throw new Error('no product');
      return unwrap(await api.patch(`/admin/products/${editing._id}`, payload));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-products'] });
      qc.invalidateQueries({ queryKey: ['admin-categories'] });
      toast({ title: 'Đã lưu', tone: 'success' });
      setEditing(null);
    },
    onError: (err) => toast({ title: 'Lỗi', description: getErrorMessage(err), tone: 'danger' }),
  });

  const suggestTags = useMutation({
    mutationFn: async () => {
      const metadata = editing && editing !== 'new' ? editing.ingredientMetadata : undefined;
      return unwrap(
        await api.post<TagSuggestions>('/admin/products/ai-tag-suggestions', {
          name: form.name,
          description: form.description,
          ...(form.categoryId ? { categoryId: form.categoryId } : {}),
          tags: parseTags(form.tagInput),
          flavorProfile: metadata?.flavorProfile ?? [],
          caffeine: metadata?.caffeine ?? null,
          dairy: metadata?.dairy ?? null,
        }),
      );
    },
    onSuccess: (data) => setTagSuggestions(data),
    onError: (err) =>
      toast({ title: 'Chưa gợi ý được tag', description: getErrorMessage(err), tone: 'danger' }),
  });

  const addSuggestedTags = (tags: string[]) => {
    const current = parseTags(form.tagInput);
    const next = [...current, ...tags.filter((tag) => !current.includes(tag))];
    setForm({ ...form, tagInput: next.join(', ') });
    setTagSuggestions((prev) =>
      prev ? { ...prev, tags: prev.tags.filter((tag) => !tags.includes(tag)) } : prev,
    );
  };

  const archive = useMutation({
    mutationFn: async (id: string) => unwrap(await api.delete(`/admin/products/${id}`)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-products'] });
      for (const key of ['menu', 'menu-search']) void qc.invalidateQueries({ queryKey: [key] });
      setDeleting(null);
      toast({ title: 'Đã xóa món khỏi thực đơn', tone: 'success' });
    },
    onError: (err) => toast({ title: 'Lỗi', description: getErrorMessage(err), tone: 'danger' }),
  });

  const restore = useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.patch(`/admin/products/${id}`, { isArchived: false })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-products'] });
      toast({ title: 'Đã khôi phục', tone: 'success' });
    },
    onError: (err) =>
      toast({
        title: 'Chưa khôi phục được món',
        description: getErrorMessage(err),
        tone: 'danger',
      }),
  });

  if (productsQuery.isLoading) return <Skeleton className="h-64" />;
  if (productsQuery.isError)
    return (
      <ErrorState
        message={getErrorMessage(productsQuery.error)}
        onRetry={() => productsQuery.refetch()}
      />
    );

  const items = productsQuery.data?.products ?? [];
  const term = normalizeProductName(search);
  const matches = (product: AdminProduct) => normalizeProductName(product.name).includes(term);
  const visible = items.filter((p) => !p.isArchived && matches(p));
  const archived = items.filter((p) => p.isArchived && matches(p));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-2xl font-semibold">Quản lý món ({items.length})</h1>
        <Button onClick={() => setEditing('new')}>
          <Plus className="h-4 w-4" /> Thêm món
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-md">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            aria-label="Tìm món"
            placeholder="Tìm theo tên món…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-10 pr-11 text-base"
          />
          {search ? (
            <button
              type="button"
              aria-label="Xóa tìm kiếm"
              className="absolute right-1 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md hover:bg-muted"
              onClick={() => setSearch('')}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <p role="status" className="text-sm text-muted-foreground">
          {visible.length + archived.length} / {items.length} món
        </p>
      </div>

      {visible.length + archived.length === 0 ? (
        <Card className="p-5 text-sm text-muted-foreground">
          {term ? 'Không tìm thấy món phù hợp.' : 'Chưa có món.'}
        </Card>
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((p) => (
          <Card key={p._id} data-product-id={p._id} className="overflow-hidden">
            <img
              src={p.image}
              alt={p.name}
              className="aspect-[2/1] w-full object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
            <div className="space-y-3 p-5">
              <div className="flex items-start justify-between gap-2">
                <p className="line-clamp-1 font-display text-lg font-semibold">{p.name}</p>
                <Badge tone={p.isAvailable ? 'success' : 'warning'}>
                  {p.isAvailable ? 'Đang bán' : 'Tạm hết'}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground line-clamp-2">{p.description}</p>
              <p className="text-sm font-semibold">
                {vnd(p.basePrice)}
                {p.variants.length > 1 ? ` · ${p.variants.length} size` : ''}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setEditing(p)}>
                  <Pencil className="h-3 w-3" /> Sửa
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-danger"
                  onClick={() => setDeleting(p)}
                >
                  <Trash2 className="h-3 w-3" /> Xóa
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {archived.length > 0 && (
        <details className="rounded-lg border border-border p-3" open={term ? true : undefined}>
          <summary className="cursor-pointer text-sm font-semibold">
            Món đã xóa ({archived.length})
          </summary>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {archived.map((p) => (
              <Card
                key={p._id}
                data-product-id={p._id}
                className="p-3 flex flex-wrap items-center justify-between gap-3"
              >
                <div>
                  <p className="font-semibold">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{vnd(p.basePrice)}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={restore.isPending}
                  onClick={() => restore.mutate(p._id)}
                >
                  <ArchiveRestore className="h-3 w-3" /> Khôi phục
                </Button>
              </Card>
            ))}
          </div>
        </details>
      )}

      <Modal
        open={!!deleting}
        onOpenChange={(open) => !open && !archive.isPending && setDeleting(null)}
        title={`Xóa món: ${deleting?.name ?? ''}`}
        description="Món sẽ được gỡ khỏi thực đơn, tìm kiếm và gợi ý AI. Lịch sử đơn và doanh thu vẫn được giữ lại."
      >
        <p className="text-sm text-muted-foreground">
          Bạn có thể khôi phục món từ mục “Món đã xóa”. Đơn đã gửi vẫn được giữ nguyên để phục vụ và
          thanh toán.
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={archive.isPending} onClick={() => setDeleting(null)}>
            Giữ món
          </Button>
          <Button
            variant="danger"
            disabled={archive.isPending}
            onClick={() => deleting && archive.mutate(deleting._id)}
          >
            {archive.isPending ? 'Đang xóa…' : 'Xóa món'}
          </Button>
        </div>
      </Modal>

      <Modal
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing === 'new' ? 'Thêm món mới' : editing ? `Sửa: ${editing.name}` : ''}
        className="max-w-2xl"
      >
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label="Tên món">
            <input
              className={inputCls}
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="Mô tả">
            <textarea
              className={inputCls + ' min-h-20'}
              required
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Field>
          <Field label="URL ảnh">
            <input
              className={inputCls}
              required
              value={form.image}
              onChange={(e) => setForm({ ...form, image: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Giá cơ bản (VND)">
              <input
                className={inputCls}
                type="number"
                min={0}
                required
                value={form.basePrice}
                onChange={(e) => setForm({ ...form, basePrice: e.target.value })}
              />
            </Field>
            <Field label="Danh mục">
              <select
                className={inputCls}
                aria-label="Danh mục"
                required
                value={form.categoryId}
                onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
              >
                <option value="">-- chọn --</option>
                {categoriesQuery.data?.categories.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name}
                    {!c.isActive ? ' (đã ẩn)' : ''}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Tags (phân cách dấu phẩy)">
            <input
              className={inputCls}
              placeholder="best-seller, signature"
              value={form.tagInput}
              onChange={(e) => setForm({ ...form, tagInput: e.target.value })}
            />
          </Field>
          <div className="space-y-2 rounded-md border border-border p-3" data-testid="ai-tag-panel">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                Tag giúp AI và tìm kiếm hiểu món (mát lạnh, tỉnh táo…). Chọn rồi bấm Lưu.
              </p>
              <Button
                size="sm"
                variant="outline"
                type="button"
                disabled={suggestTags.isPending || !form.name.trim()}
                onClick={() => suggestTags.mutate()}
              >
                <Sparkles className="h-3 w-3" />
                {suggestTags.isPending ? 'Đang gợi ý…' : 'AI gợi ý tag'}
              </Button>
            </div>
            {tagSuggestions ? (
              tagSuggestions.tags.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={tagSuggestions.mode === 'llm' ? 'success' : 'warning'}>
                    {tagSuggestions.mode === 'llm' ? 'AI' : 'Theo mô tả'}
                  </Badge>
                  {tagSuggestions.tags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      className="rounded-full border border-border px-3 py-1 text-xs hover:bg-muted"
                      aria-label={`Thêm tag ${tag}`}
                      onClick={() => addSuggestedTags([tag])}
                    >
                      + {tag}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="text-xs font-medium text-primary underline"
                    onClick={() => addSuggestedTags(tagSuggestions.tags)}
                  >
                    Thêm tất cả
                  </button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Không có tag mới để gợi ý.</p>
              )
            ) : null}
          </div>
          <div>
            <p className="text-sm font-medium mb-1">Size / giá</p>
            <div className="space-y-1">
              {form.variants.map((v, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    className={inputCls + ' w-20'}
                    placeholder="Tên"
                    value={v.name}
                    onChange={(e) => {
                      const next = [...form.variants];
                      next[i] = { ...v, name: e.target.value };
                      setForm({ ...form, variants: next });
                    }}
                  />
                  <input
                    className={inputCls + ' flex-1'}
                    type="number"
                    min={0}
                    placeholder="Giá"
                    value={v.price}
                    onChange={(e) => {
                      const next = [...form.variants];
                      next[i] = { ...v, price: Number(e.target.value) };
                      setForm({ ...form, variants: next });
                    }}
                  />
                  <button
                    type="button"
                    className="text-xs text-danger"
                    onClick={() =>
                      setForm({ ...form, variants: form.variants.filter((_, idx) => idx !== i) })
                    }
                  >
                    Xoá
                  </button>
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                type="button"
                onClick={() =>
                  setForm({
                    ...form,
                    variants: [
                      ...form.variants,
                      { name: 'L', price: Number(form.basePrice) + 5000, isAvailable: true },
                    ],
                  })
                }
              >
                <Plus className="h-3 w-3" /> Thêm size
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isAvailable}
                onChange={(e) => setForm({ ...form, isAvailable: e.target.checked })}
              />
              Đang bán
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isFeatured}
                onChange={(e) => setForm({ ...form, isFeatured: e.target.checked })}
              />
              Nổi bật
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isArchived}
                onChange={(e) => setForm({ ...form, isArchived: e.target.checked })}
              />
              Đã xóa mềm
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={() => setEditing(null)}>
              Huỷ
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Đang lưu...' : 'Lưu'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

interface TagSuggestions {
  mode: 'llm' | 'fallback';
  tags: string[];
}

function parseTags(value: string): string[] {
  return value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

function normalizeProductName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .trim()
    .replace(/\s+/g, ' ');
}

const inputCls =
  'w-full rounded-md border border-control bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary';

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
