import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { api, getErrorMessage, unwrap } from '../../lib/api';
import { useToast } from '../../components/ui/Toast';
import { ErrorState, useDocumentTitle } from '../../components/ui/EmptyState';

interface Category {
  _id: string;
  name: string;
  slug: string;
  sortOrder: number;
  isActive: boolean;
}

export function AdminCategories(): JSX.Element {
  useDocumentTitle('Danh mục');
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');

  const listQuery = useQuery({
    queryKey: ['admin-categories'],
    queryFn: async () => unwrap(await api.get<{ categories: Category[] }>('/admin/categories')),
  });

  const create = useMutation({
    mutationFn: async () => unwrap(await api.post('/admin/categories', { name, slug })),
    onSuccess: () => {
      toast({ title: 'Đã tạo danh mục', tone: 'success' });
      setName('');
      setSlug('');
      queryClient.invalidateQueries({ queryKey: ['admin-categories'] });
    },
    onError: (err) => toast({ title: 'Lỗi', description: getErrorMessage(err), tone: 'danger' }),
  });

  if (listQuery.isError) return <ErrorState message={getErrorMessage(listQuery.error)} onRetry={() => listQuery.refetch()} />;

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-semibold">Danh mục</h1>
      <Card className="p-4">
        <h3 className="font-semibold mb-3">Thêm danh mục</h3>
        <form
          className="grid grid-cols-1 sm:grid-cols-[1fr,1fr,auto] gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Input placeholder="Tên" value={name} onChange={(e) => setName(e.target.value)} required />
          <Input placeholder="slug" value={slug} onChange={(e) => setSlug(e.target.value)} required />
          <Button type="submit" disabled={create.isPending}>Tạo</Button>
        </form>
      </Card>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {listQuery.data?.categories.map((c) => (
          <Card key={c._id} className="p-3 flex items-center justify-between">
            <div>
              <p className="font-display font-semibold">{c.name}</p>
              <p className="text-xs text-muted-foreground">{c.slug}</p>
            </div>
            <span className={`text-xs ${c.isActive ? 'text-success' : 'text-muted-foreground'}`}>{c.isActive ? 'Đang hiển thị' : 'Đã ẩn'}</span>
          </Card>
        ))}
      </div>
    </div>
  );
}
