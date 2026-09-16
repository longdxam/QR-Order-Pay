import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Skeleton';
import { ErrorState, useDocumentTitle } from '../../components/ui/EmptyState';
import { api, getErrorMessage, unwrap, vnd } from '../../lib/api';
import { useToast } from '../../components/ui/Toast';

interface AdminProduct {
  _id: string;
  name: string;
  description: string;
  image: string;
  basePrice: number;
  isAvailable: boolean;
  isArchived: boolean;
  isFeatured: boolean;
  tags: string[];
}

export function AdminProducts(): JSX.Element {
  useDocumentTitle('Quản lý món');
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const productsQuery = useQuery({
    queryKey: ['admin-products'],
    queryFn: async () => unwrap(await api.get<{ products: AdminProduct[] }>('/admin/products')),
  });

  const toggle = useMutation({
    mutationFn: async (input: { id: string; isAvailable: boolean }) =>
      unwrap(await api.patch(`/admin/products/${input.id}`, { isAvailable: input.isAvailable })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-products'] });
      toast({ title: 'Đã cập nhật', tone: 'success' });
    },
    onError: (err) => toast({ title: 'Lỗi', description: getErrorMessage(err), tone: 'danger' }),
  });

  const archive = useMutation({
    mutationFn: async (id: string) => unwrap(await api.delete(`/admin/products/${id}`)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-products'] });
      toast({ title: 'Đã ẩn món', tone: 'success' });
    },
    onError: (err) => toast({ title: 'Lỗi', description: getErrorMessage(err), tone: 'danger' }),
  });

  if (productsQuery.isLoading) return <Skeleton className="h-64" />;
  if (productsQuery.isError) return <ErrorState message={getErrorMessage(productsQuery.error)} onRetry={() => productsQuery.refetch()} />;

  const items = productsQuery.data?.products ?? [];

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-semibold">Quản lý món ({items.length})</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {items.map((p) => (
          <Card key={p._id} className="overflow-hidden">
            <img src={p.image} alt={p.name} className="h-32 w-full object-cover" />
            <div className="p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <p className="font-display font-semibold line-clamp-1">{p.name}</p>
                <Badge tone={p.isArchived ? 'danger' : p.isAvailable ? 'success' : 'warning'}>
                  {p.isArchived ? 'Đã ẩn' : p.isAvailable ? 'Đang bán' : 'Tạm hết'}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground line-clamp-2">{p.description}</p>
              <p className="text-sm font-semibold">{vnd(p.basePrice)}</p>
              <div className="flex gap-2">
                {!p.isArchived ? (
                  <Button size="sm" variant="outline" onClick={() => toggle.mutate({ id: p._id, isAvailable: !p.isAvailable })}>
                    {p.isAvailable ? 'Tạm hết' : 'Mở bán lại'}
                  </Button>
                ) : null}
                {!p.isArchived ? (
                  <Button size="sm" variant="danger" onClick={() => archive.mutate(p._id)}>
                    Ẩn món
                  </Button>
                ) : null}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
