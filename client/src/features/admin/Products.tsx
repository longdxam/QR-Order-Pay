import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2, ArchiveRestore, Search, X } from 'lucide-react';
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
import {
  EMPTY_FORM,
  buildProductPayload,
  formFromProduct,
  mergeSuggestedTags,
  normalizeProductName,
  parseTags,
  type AdminProduct,
  type Category,
  type FormState,
  type TagSuggestions,
} from './products/model';
import { ProductForm } from './products/ProductForm';
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
      setForm(formFromProduct(editing));
    }
  }, [editing, categoriesQuery.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!editing) throw new Error('no product');
      const payload = buildProductPayload(form, editing === 'new' ? null : editing);
      if (editing === 'new') return unwrap(await api.post('/admin/products', payload));
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
    const merged = mergeSuggestedTags(form, tagSuggestions, tags);
    setForm(merged.form);
    setTagSuggestions(merged.suggestions);
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
        <ProductForm
          form={form}
          onChange={setForm}
          categories={categoriesQuery.data?.categories ?? []}
          saving={save.isPending}
          onSubmit={() => save.mutate()}
          onCancel={() => setEditing(null)}
          tagSuggestions={tagSuggestions}
          suggesting={suggestTags.isPending}
          onSuggestTags={() => suggestTags.mutate()}
          onAddTags={addSuggestedTags}
        />{' '}
      </Modal>
    </div>
  );
}
