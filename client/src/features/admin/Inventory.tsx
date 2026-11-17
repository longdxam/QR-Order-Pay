import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IngredientDto, StockMovementDto } from '@may-cafe/contracts';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Skeleton';
import { ErrorState } from '../../components/ui/EmptyState';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';
import { useToast } from '../../components/ui/useToast';
import { api, getErrorMessage, unwrap } from '../../lib/api';
import { Field } from './inventory/Field';
import { number, selectClass, unitLabel, type Overview } from './inventory/shared';
import { IngredientForm, MovementForm } from './inventory/IngredientForms';
import { RecipePanel } from './inventory/RecipePanel';

interface History {
  items: StockMovementDto[];
  total: number;
  page: number;
  limit: number;
}
const movementLabels: Record<StockMovementDto['type'], string> = {
  RECEIPT: 'Nhập kho',
  ISSUE: 'Xuất khác / hao hụt',
  ADJUSTMENT: 'Kiểm kê',
  RESERVE: 'Giữ cho đơn',
  RELEASE: 'Trả phần giữ',
  CONSUME: 'Xuất pha chế',
};

export function AdminInventory(): JSX.Element {
  useDocumentTitle('Kho & công thức');
  const qc = useQueryClient();
  const [tab, setTab] = useState<'ingredients' | 'recipes' | 'history'>('ingredients');
  const [ingredientForm, setIngredientForm] = useState<IngredientDto | 'new' | null>(null);
  const [moving, setMoving] = useState<IngredientDto | null>(null);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const { toast } = useToast();
  const removeIngredient = useMutation({
    mutationFn: async (ingredient: IngredientDto) =>
      api.delete(`/admin/inventory/ingredients/${ingredient.id}`),
    onSuccess: () => {
      refresh();
      toast({ title: 'Đã xóa nguyên liệu', tone: 'success' });
    },
    onError: (error) =>
      toast({ title: 'Chưa xóa được', description: getErrorMessage(error), tone: 'danger' }),
  });
  const query = useQuery({
    queryKey: ['admin-inventory'],
    queryFn: async () => unwrap<Overview>(await api.get('/admin/inventory')),
    refetchInterval: 10000,
  });
  const history = useQuery({
    queryKey: ['inventory-history', page, filter],
    enabled: tab === 'history',
    queryFn: async () =>
      unwrap<History>(
        await api.get('/admin/inventory/movements', {
          params: { page, ...(filter ? { ingredientId: filter } : {}) },
        }),
      ),
    refetchInterval: 10000,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin-inventory'] });
    void qc.invalidateQueries({ queryKey: ['inventory-history'] });
    void qc.invalidateQueries({ queryKey: ['staff-availability'] });
  };
  if (query.isLoading) return <Skeleton className="h-80" />;
  if (query.isError)
    return <ErrorState message={getErrorMessage(query.error)} onRetry={() => query.refetch()} />;
  const data = query.data!;
  const normalizedSearch = normalizeIngredientName(search.trim());
  const inactiveCount = data.ingredients.filter((ingredient) => !ingredient.isActive).length;
  const visibleIngredients = data.ingredients.filter(
    (ingredient) =>
      (showInactive || ingredient.isActive) &&
      normalizeIngredientName(ingredient.name).includes(normalizedSearch),
  );
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Kho & công thức</h1>
        </div>
        <Button onClick={() => setIngredientForm('new')}>Thêm nguyên liệu</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Nguyên liệu đang dùng</p>
          <strong className="text-2xl">{data.ingredients.filter((i) => i.isActive).length}</strong>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Sắp hết / hết</p>
          <strong className="text-2xl">
            {data.ingredients.filter((i) => i.isActive && i.isLowStock).length}
          </strong>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Công thức đang áp dụng</p>
          <strong className="text-2xl">{data.recipes.filter((r) => r.enabled).length}</strong>
        </Card>
      </div>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Quản lý kho">
        {(
          [
            ['ingredients', 'Nguyên liệu'],
            ['recipes', 'Công thức'],
            ['history', 'Lịch sử kho'],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            role="tab"
            aria-selected={tab === value}
            variant={tab === value ? 'primary' : 'outline'}
            onClick={() => setTab(value)}
          >
            {label}
          </Button>
        ))}
      </div>
      {tab === 'ingredients' && (
        <section className="space-y-4" aria-label="Danh sách nguyên liệu">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              type="search"
              aria-label="Tìm nguyên liệu"
              placeholder="Tìm theo tên nguyên liệu..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="max-w-md"
            />
            <p className="text-sm text-muted-foreground" role="status">
              {visibleIngredients.length} / {data.ingredients.length} nguyên liệu
            </p>
            {inactiveCount > 0 ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(event) => setShowInactive(event.target.checked)}
                />
                Hiện nguyên liệu ngừng dùng ({inactiveCount})
              </label>
            ) : null}
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.ingredients.length === 0 && (
              <Card className="p-5 md:col-span-2">
                <p>
                  Chưa có nguyên liệu. Thêm nguyên liệu, nhập tồn đầu và cấu hình công thức cho món.
                </p>
              </Card>
            )}
            {data.ingredients.length > 0 && visibleIngredients.length === 0 && (
              <Card className="p-5 md:col-span-2">Không tìm thấy nguyên liệu phù hợp.</Card>
            )}
            {visibleIngredients.map((i) => (
              <Card key={i.id} className="min-w-0 space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="break-words font-semibold">{i.name}</h2>
                    <p className="text-xs text-muted-foreground">Đơn vị: {unitLabel(i.unit)}</p>
                  </div>
                  <Badge tone={!i.isActive ? 'neutral' : i.isLowStock ? 'danger' : 'success'}>
                    {!i.isActive ? 'Ngừng dùng' : i.isLowStock ? 'Sắp hết / hết' : 'Đủ tồn'}
                  </Badge>
                </div>
                <dl className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <dt className="text-muted-foreground">Tồn thực</dt>
                    <dd>{number(i.onHand)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Đang giữ</dt>
                    <dd>{number(i.reserved)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Có thể dùng</dt>
                    <dd className="font-semibold">{number(i.available)}</dd>
                  </div>
                </dl>
                <p className="text-xs text-muted-foreground">
                  Ngưỡng cảnh báo: {number(i.lowStockThreshold)} {unitLabel(i.unit)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Giá vốn:{' '}
                  {i.unitCost === null || i.unitCost === undefined
                    ? 'Chưa nhập'
                    : `${number(i.unitCost)} đ/${unitLabel(i.unit)}`}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={!i.isActive} onClick={() => setMoving(i)}>
                    Nhập / xuất / kiểm kê
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setIngredientForm(i)}>
                    Sửa
                  </Button>
                  {i.onHand === 0 && i.reserved === 0 ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-danger"
                      disabled={removeIngredient.isPending}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Xóa hẳn nguyên liệu "${i.name}"? Chỉ xóa được nguyên liệu chưa từng nhập/xuất kho và chưa nằm trong công thức nào; nếu đã dùng, hãy chọn Ngừng dùng.`,
                          )
                        )
                          removeIngredient.mutate(i);
                      }}
                    >
                      Xóa
                    </Button>
                  ) : null}
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}
      {tab === 'recipes' && <RecipePanel data={data} onSaved={refresh} />}
      {tab === 'history' && (
        <Card className="space-y-4 p-4">
          <Field label="Lọc nguyên liệu">
            <select
              className={selectClass}
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Tất cả nguyên liệu</option>
              {data.ingredients.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </Field>
          {history.isLoading ? (
            <Skeleton className="h-40" />
          ) : history.isError ? (
            <ErrorState
              message={getErrorMessage(history.error)}
              onRetry={() => history.refetch()}
            />
          ) : (
            <>
              {history.data?.items.length === 0 && (
                <p className="text-sm text-muted-foreground">Chưa có biến động kho.</p>
              )}
              <div className="divide-y divide-border">
                {history.data?.items.map((m) => (
                  <div key={m.id} className="space-y-1 py-3 text-sm">
                    <div className="flex flex-wrap justify-between gap-2">
                      <strong>
                        {m.ingredientName} · {movementLabels[m.type]}
                      </strong>
                      <span>
                        {number(m.quantity)} {unitLabel(m.unit)}
                      </span>
                    </div>
                    <p>{m.reason}</p>
                    <p className="text-xs text-muted-foreground">
                      Tồn: {number(m.onHandAfter)} · Đang giữ: {number(m.reservedAfter)} ·{' '}
                      {m.actorName} · {new Date(m.createdAt).toLocaleString('vi-VN')}
                    </p>
                    {m.orderId && <p className="text-xs text-muted-foreground">Gắn với đơn hàng</p>}
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  Trước
                </Button>
                <span className="text-sm">
                  Trang {page} · {history.data?.total ?? 0} biến động
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page * 30 >= (history.data?.total ?? 0)}
                  onClick={() => setPage(page + 1)}
                >
                  Sau
                </Button>
              </div>
            </>
          )}
        </Card>
      )}
      {ingredientForm && (
        <IngredientForm
          key={typeof ingredientForm === 'string' ? 'new' : ingredientForm.id}
          ingredient={ingredientForm === 'new' ? null : ingredientForm}
          onClose={() => setIngredientForm(null)}
          onSaved={refresh}
        />
      )}
      {moving && (
        <MovementForm ingredient={moving} onClose={() => setMoving(null)} onSaved={refresh} />
      )}
    </div>
  );
}

function normalizeIngredientName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase();
}
