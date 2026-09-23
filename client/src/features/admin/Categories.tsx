import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Power } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { api, getErrorMessage, unwrap } from '../../lib/api';
import { useToast } from '../../components/ui/useToast';
import { ErrorState } from '../../components/ui/EmptyState';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';

interface Category {
  _id: string;
  name: string;
  slug: string;
  sortOrder: number;
  isActive: boolean;
}

function slugify(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export function AdminCategories(): JSX.Element {
  useDocumentTitle('Danh mục');
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<Category | null>(null);
  const [editName, setEditName] = useState('');

  const listQuery = useQuery({
    queryKey: ['admin-categories'],
    queryFn: async () => unwrap(await api.get<{ categories: Category[] }>('/admin/categories')),
  });

  const create = useMutation({
    mutationFn: async () => unwrap(await api.post('/admin/categories', { name, slug: slugify(name) })),
    onSuccess: () => {
      toast({ title: 'Đã tạo danh mục', tone: 'success' });
      setName('');
      qc.invalidateQueries({ queryKey: ['admin-categories'] });
    },
    onError: (err) => toast({ title: 'Lỗi', description: getErrorMessage(err), tone: 'danger' }),
  });

  const update = useMutation({
    mutationFn: async (input: { id: string; data: Partial<Category> }) =>
      unwrap(await api.patch(`/admin/categories/${input.id}`, input.data)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-categories'] });
      toast({ title: 'Đã cập nhật', tone: 'success' });
      setEditing(null);
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
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Input placeholder="Tên danh mục (vd: Trà sữa)" value={name} onChange={(e) => setName(e.target.value)} required />
          <Button type="submit" disabled={create.isPending}>
            <Plus className="h-4 w-4" /> Tạo
          </Button>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">Slug tự sinh từ tên (vd: "Trà sữa" → "tra-sua").</p>
      </Card>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {listQuery.data?.categories.map((c) => (
          <Card key={c._id} className="p-3 space-y-2">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-display font-semibold">{c.name}</p>
                <p className="text-xs text-muted-foreground">{c.slug}</p>
              </div>
              <span className={`text-xs ${c.isActive ? 'text-success' : 'text-muted-foreground'}`}>
                {c.isActive ? 'Đang hiển thị' : 'Đã ẩn'}
              </span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => { setEditing(c); setEditName(c.name); }}>
                <Pencil className="h-3 w-3" /> Sửa tên
              </Button>
              <Button size="sm" variant="outline" onClick={() => update.mutate({ id: c._id, data: { isActive: !c.isActive } })}>
                <Power className="h-3 w-3" /> {c.isActive ? 'Ẩn' : 'Hiện'}
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <Modal open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title={`Sửa danh mục: ${editing?.slug ?? ''}`}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!editing) return;
            update.mutate({ id: editing._id, data: { name: editName } });
          }}
        >
          <Input value={editName} onChange={(e) => setEditName(e.target.value)} required />
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={() => setEditing(null)}>Huỷ</Button>
            <Button type="submit" disabled={update.isPending}>Lưu</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
