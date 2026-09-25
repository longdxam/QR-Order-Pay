import { useEffect, useState } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  Coffee,
  LayoutDashboard,
  UtensilsCrossed,
  Layers,
  Sparkles,
  Table2,
  Users,
  LogOut,
  MessageSquareText,
  ReceiptText,
} from 'lucide-react';
import { useAuth } from '../features/auth/useAuth';
import { Badge } from '../components/ui/Badge';
import { useQuery } from '@tanstack/react-query';
import { createOverviewReport } from '../lib/reportJobs';

const NAV = [
  { to: '/admin/dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
  { to: '/admin/operations', label: 'Vận hành', icon: <Activity className="h-4 w-4" /> },
  { to: '/admin/bills', label: 'Hóa đơn', icon: <ReceiptText className="h-4 w-4" /> },
  { to: '/admin/products', label: 'Món', icon: <UtensilsCrossed className="h-4 w-4" /> },
  { to: '/admin/categories', label: 'Danh mục', icon: <Layers className="h-4 w-4" /> },
  { to: '/admin/toppings', label: 'Topping', icon: <Sparkles className="h-4 w-4" /> },
  { to: '/admin/tables', label: 'Bàn & QR', icon: <Table2 className="h-4 w-4" /> },
  { to: '/admin/users', label: 'Nhân viên', icon: <Users className="h-4 w-4" /> },
  { to: '/admin/reviews', label: 'Đánh giá', icon: <MessageSquareText className="h-4 w-4" /> },
];

export function AdminLayout(): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const overviewQuery = useQuery({
    queryKey: ['admin-overview-quick'],
    queryFn: ({ signal }) => createOverviewReport({}, 'json', signal),
    refetchInterval: 60_000,
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-foreground/5 bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-4 py-3">
          <Link to="/admin" className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Coffee className="h-4 w-4" />
            </span>
            <div>
              <p className="font-display text-base font-semibold leading-tight">
                Mây Café — Quản trị
              </p>
              <p className="text-xs text-muted-foreground leading-tight">
                {user?.name ?? 'Quản trị'} · {user?.role ?? ''}
              </p>
            </div>
          </Link>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Badge tone="info">
              {now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
            </Badge>
            <span>
              {overviewQuery.data
                ? `${overviewQuery.data.orderCount} đơn đã thanh toán (30 ngày)`
                : 'Đang tải...'}
            </span>
          </div>
        </div>
        <nav className="mx-auto max-w-7xl px-2 pb-2 flex flex-wrap gap-1">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                location.pathname === n.to
                  ? 'bg-primary text-primary-foreground'
                  : 'text-foreground/70 hover:bg-muted'
              }`}
            >
              {n.icon}
              {n.label}
            </Link>
          ))}
          <button
            onClick={async () => {
              await logout();
              navigate('/auth/login');
            }}
            className="ml-auto btn-ghost text-xs"
          >
            <LogOut className="h-3 w-3" /> Đăng xuất
          </button>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 py-4">
        <Outlet />
      </main>
    </div>
  );
}
