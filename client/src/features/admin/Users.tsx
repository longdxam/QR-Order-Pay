import { useQuery } from '@tanstack/react-query';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Skeleton';
import { api, getErrorMessage, unwrap } from '../../lib/api';
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
  const query = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => unwrap(await api.get<{ users: AdminUser[] }>('/admin/users')),
  });

  if (query.isLoading) return <Skeleton className="h-64" />;
  if (query.isError) return <ErrorState message={getErrorMessage(query.error)} onRetry={() => query.refetch()} />;

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-semibold">Tài khoản nhân viên</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {query.data?.users.map((u) => (
          <Card key={u.id} className="p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-display font-semibold">{u.name}</p>
                <p className="text-xs text-muted-foreground">{u.email}</p>
              </div>
              <Badge tone={u.role === 'ADMIN' ? 'info' : 'neutral'}>{u.role}</Badge>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Trạng thái: <span className={u.isActive ? 'text-success' : 'text-danger'}>{u.isActive ? 'Đang hoạt động' : 'Đã khoá'}</span>
            </p>
            <p className="text-xs text-muted-foreground">Tạo: {new Date(u.createdAt).toLocaleDateString('vi-VN')}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
