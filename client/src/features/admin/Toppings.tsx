import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { api, getErrorMessage, unwrap, vnd } from '../../lib/api';
import { useToast } from '../../components/ui/useToast';
import { ErrorState } from '../../components/ui/EmptyState';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';

interface Topping {
  _id: string;
  name: string;
  price: number;
  isAvailable: boolean;
  isArchived: boolean;
}

export function AdminToppings(): JSX.Element {
  useDocumentTitle('Topping');
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('8000');

  const listQuery = useQuery({
    queryKey: ['admin-toppings'],
    queryFn: async () => unwrap(await api.get<{ toppings: Topping[] }>('/admin/toppings')),
  });

  const create = useMutation({
    mutationFn: async () =>
      unwrap(await api.post('/admin/toppings', { name, price: Number(price) })),
    onSuccess: () => {
      toast({ title: 'Đã tạo topping', tone: 'success' });
      setName('');
      setPrice('8000');
      queryClient.invalidateQueries({ queryKey: ['admin-toppings'] });
    },
    onError: (err) => toast({ title: 'Lỗi', description: getErrorMessage(err), tone: 'danger' }),
  });

  const toggle = useMutation({
    mutationFn: async (input: { id: string; isAvailable: boolean }) =>
      unwrap(await api.patch(`/admin/toppings/${input.id}`, { isAvailable: input.isAvailable })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-toppings'] }),
  });

  if (listQuery.isError) return <ErrorState message={getErrorMessage(listQuery.error)} onRetry={() => listQuery.refetch()} />;

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-semibold">Topping</h1>
      <Card className="p-4">
        <form
          className="grid grid-cols-1 sm:grid-cols-[1fr,120px,auto] gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Input placeholder="Tên topping" value={name} onChange={(e) => setName(e.target.value)} required />
          <Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} required min={0} />
          <Button type="submit" disabled={create.isPending}>Tạo</Button>
        </form>
      </Card>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {listQuery.data?.toppings.map((t) => (
          <Card key={t._id} className="p-3 flex items-center justify-between">
            <div>
              <p className="font-display font-semibold">{t.name}</p>
              <p className="text-xs text-muted-foreground">{vnd(t.price)}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={t.isAvailable ? 'success' : 'warning'}>{t.isAvailable ? 'Đang bán' : 'Tạm hết'}</Badge>
              <Button size="sm" variant="outline" onClick={() => toggle.mutate({ id: t._id, isAvailable: !t.isAvailable })}>
                Đổi
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
