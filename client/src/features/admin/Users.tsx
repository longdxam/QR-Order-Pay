import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Power, KeyRound } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { Skeleton } from '../../components/ui/Skeleton';
import { api, getErrorMessage, unwrap } from '../../lib/api';
import { useToast } from '../../components/ui/Toast';
import { ErrorState, useDocumentTitle } from '../../components/ui/EmptyState';

interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'STAFF';
  isActive: boolean;
  createdAt: string;
}

export function AdminUsers(): JSX.Element {
  useDocumentTitle('Nhân viên');
  const qc = useQueryClient();
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);
  const [pwdFor, setPwdFor] = useState<AdminUser | null>(null);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'STAFF' as 'STAFF' | 'ADMIN' });

  const query = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => unwrap(await api.get<{ users: AdminUser[] }>('/admin/users')),
  });

  const create = useMutation({
    mutationFn: async () => unwrap(await api.post('/admin/users', form)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      toast({ title: 'Đã tạo tài khoản', tone: 'success' });
      setCreating(false);
      setForm({ name: '', email: '', password: '', role: 'STAFF' });
    },
    onError: (err) => toast({ title: 'Lỗi', description: getErrorMessage(err), tone: 'danger' }),
  });

  const toggle = useMutation({
    mutationFn: async (input: { id: string; isActive: boolean }) =>
      unwrap(await api.patch(`/admin/users/${input.id}`, { isActive: input.isActive })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      toast({ title: 'Đã cập nhật', tone: 'success' });
    },
    onError: (err) => toast({ title: 'Lỗi', description: getErrorMessage(err), tone: 'danger' }),
  });

  const resetPwd = useMutation({
    mutationFn: async (input: { id: string; password: string }) =>
      unwrap(await api.patch(`/admin/users/${input.id}`, { password: input.password })),
    onSuccess: () => {
      toast({ title: 'Đã đặt lại mật khẩu', tone: 'success' });
      setPwdFor(null);
    },
    onError: (err) => toast({ title: 'Lỗi', description: getErrorMessage(err), tone: 'danger' }),
  });

  if (query.isLoading) return <Skeleton className="h-64" />;
  if (query.isError) return <ErrorState message={getErrorMessage(query.error)} onRetry={() => query.refetch()} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold">Tài khoản nhân viên</h1>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> Thêm nhân viên
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {query.data?.users.map((u) => (
          <Card key={u.id} className="p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-display font-semibold">{u.name}</p>
                <p className="text-xs text-muted-foreground">{u.email}</p>
              </div>
              <Badge tone={u.role === 'ADMIN' ? 'info' : 'neutral'}>{u.role}</Badge>
            </div>
            <p className="text-xs">
              Trạng thái:{' '}
              <span className={u.isActive ? 'text-success' : 'text-danger'}>
                {u.isActive ? 'Đang hoạt động' : 'Đã khoá'}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">Tạo: {new Date(u.createdAt).toLocaleDateString('vi-VN')}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => toggle.mutate({ id: u.id, isActive: !u.isActive })}>
                <Power className="h-3 w-3" /> {u.isActive ? 'Khoá' : 'Mở khoá'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setPwdFor(u)}>
                <KeyRound className="h-3 w-3" /> Đặt lại MK
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <Modal open={creating} onOpenChange={(o) => !o && setCreating(false)} title="Thêm nhân viên / admin">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <label className="block text-sm">
            Họ tên
            <Input required className="mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="block text-sm">
            Email
            <Input required type="email" className="mt-1" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label className="block text-sm">
            Mật khẩu (≥ 8 ký tự)
            <Input required minLength={8} type="password" className="mt-1" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </label>
          <label className="block text-sm">
            Vai trò
            <select className="mt-1 w-full rounded-md border border-foreground/15 bg-background px-3 py-2 text-sm" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as 'STAFF' | 'ADMIN' })}>
              <option value="STAFF">Nhân viên</option>
              <option value="ADMIN">Quản trị viên</option>
            </select>
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={() => setCreating(false)}>Huỷ</Button>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Đang tạo...' : 'Tạo'}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!pwdFor} onOpenChange={(o) => !o && setPwdFor(null)} title={`Đặt lại mật khẩu: ${pwdFor?.name ?? ''}`}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!pwdFor) return;
            const data = new FormData(e.currentTarget);
            const password = String(data.get('password') ?? '');
            if (password.length < 8) {
              toast({ title: 'Mật khẩu tối thiểu 8 ký tự', tone: 'danger' });
              return;
            }
            resetPwd.mutate({ id: pwdFor.id, password });
          }}
        >
          <Input name="password" type="password" required minLength={8} placeholder="Mật khẩu mới (≥ 8 ký tự)" />
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={() => setPwdFor(null)}>Huỷ</Button>
            <Button type="submit" disabled={resetPwd.isPending}>Lưu</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
