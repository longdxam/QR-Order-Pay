import { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { Coffee, ClipboardList, UtensilsCrossed, BellRing, LogOut, Volume2, VolumeX, Bell } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../features/auth/useAuth';
import { connectStaffSocket, disconnectSocket, useSocketEvent } from '../lib/socket';
import { Badge } from '../components/ui/Badge';
import { useToast } from '../components/ui/useToast';
import { api, unwrap } from '../lib/api';
import {
  isSoundEnabled,
  notifyBrowser,
  playAlert,
  requestNotifyPermission,
  setSoundEnabled,
  useCountDelta,
} from '../features/staff/notifications';

interface OrderRow {
  _id: string;
  code: string;
  status: 'PENDING' | 'CONFIRMED' | 'PREPARING' | 'READY' | 'SERVED' | 'CANCELLED';
  tableSessionId: string;
}

interface ServiceReqRow {
  _id: string;
  type: 'CALL_STAFF' | 'REQUEST_BILL' | 'OTHER';
  status: 'OPEN' | 'RESOLVED';
  tableName: string;
}

const NAV = [
  { to: '/staff/kds', label: 'KDS', icon: <UtensilsCrossed className="h-4 w-4" />, badgeKey: 'pending' as const },
  { to: '/staff/tables', label: 'Bàn & phiên', icon: <ClipboardList className="h-4 w-4" /> },
  { to: '/staff/service-requests', label: 'Yêu cầu', icon: <BellRing className="h-4 w-4" />, badgeKey: 'requests' as const },
];

export function StaffLayout(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, accessToken, logout } = useAuth();
  const [connected, setConnected] = useState(false);
  const [soundOn, setSoundOn] = useState<boolean>(isSoundEnabled());
  const qc = useQueryClient();
  const { toast } = useToast();

  const ordersQuery = useQuery({
    queryKey: ['staff-orders'],
    queryFn: async () => unwrap(await api.get<{ items: OrderRow[] }>('/staff/orders')),
    refetchInterval: 10_000,
  });
  const requestsQuery = useQuery({
    queryKey: ['staff-service-requests'],
    queryFn: async () => unwrap(await api.get<{ items: ServiceReqRow[] }>('/staff/service-requests')),
    refetchInterval: 8_000,
  });

  const pendingCount = useMemo(
    () => (ordersQuery.data?.items ?? []).filter((o) => o.status === 'PENDING').length,
    [ordersQuery.data],
  );
  const openRequestCount = useMemo(
    () => (requestsQuery.data?.items ?? []).filter((r) => r.status === 'OPEN').length,
    [requestsQuery.data],
  );

  const refresh = useCallback(() => {
    for (const key of ['staff-orders', 'staff-table-sessions', 'staff-bill', 'staff-service-requests']) {
      void qc.invalidateQueries({ queryKey: [key] });
    }
  }, [qc]);

  const notifyNewOrder = useCallback(
    (delta: number) => {
      playAlert('order');
      notifyBrowser('Đơn mới', `${delta} đơn mới cần xác nhận trên KDS`);
      toast({
        title: `Đơn mới (${delta})`,
        description: 'Vào KDS để xác nhận.',
        tone: 'info',
      });
    },
    [toast],
  );
  const notifyNewRequest = useCallback(
    (delta: number) => {
      playAlert('request');
      notifyBrowser('Yêu cầu mới', `${delta} yêu cầu mới từ bàn`);
      toast({
        title: `Yêu cầu mới (${delta})`,
        description: 'Khách gọi nhân viên / xin bill.',
        tone: 'info',
      });
    },
    [toast],
  );

  useCountDelta(pendingCount, notifyNewOrder);
  useCountDelta(openRequestCount, notifyNewRequest);

  useSocketEvent('connect', () => { setConnected(true); refresh(); });
  useSocketEvent('disconnect', () => setConnected(false));
  useSocketEvent('order.created', refresh);
  useSocketEvent('order.statusChanged', refresh);
  useSocketEvent('tableSession.statusChanged', refresh);
  useSocketEvent('payment.confirmed', () => {
    refresh();
    playAlert('payment');
    toast({ title: 'Đã ghi nhận thanh toán', tone: 'success' });
  });
  useSocketEvent('serviceRequest.created', refresh);
  useSocketEvent('serviceRequest.resolved', refresh);

  useEffect(() => {
    if (!accessToken) return;
    const s = connectStaffSocket(accessToken);
    setConnected(s.connected);
    void requestNotifyPermission();
    return () => {
      disconnectSocket();
    };
  }, [accessToken]);

  function toggleSound(): void {
    const next = !soundOn;
    setSoundOn(next);
    setSoundEnabled(next);
    if (next) playAlert('order');
  }

  function badgeFor(key: 'pending' | 'requests'): number | null {
    if (key === 'pending') return pendingCount > 0 ? pendingCount : null;
    return openRequestCount > 0 ? openRequestCount : null;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-foreground/5 bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-4 py-3">
          <Link to="/staff" className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Coffee className="h-4 w-4" />
            </span>
            <div>
              <p className="font-display text-base font-semibold leading-tight">Mây Café — Vận hành</p>
              <p className="text-xs text-muted-foreground leading-tight">
                {user?.name ?? 'Nhân viên'} · {user?.role ?? ''} ·{' '}
                {connected ? <Badge tone="success">Trực tuyến</Badge> : <Badge tone="danger">Mất kết nối</Badge>}
                {(pendingCount > 0 || openRequestCount > 0) && (
                  <span className="ml-2 inline-flex items-center gap-1 text-foreground/70">
                    <Bell className="h-3 w-3" />
                    {pendingCount + openRequestCount} chờ
                  </span>
                )}
              </p>
            </div>
          </Link>
          <nav className="flex items-center gap-1">
            {NAV.map((n) => {
              const badge = n.badgeKey ? badgeFor(n.badgeKey) : null;
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  className={`relative flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                    location.pathname === n.to ? 'bg-primary text-primary-foreground' : 'text-foreground/70 hover:bg-muted'
                  }`}
                >
                  {n.icon}
                  {n.label}
                  {badge !== null && (
                    <span
                      aria-label={`${badge} chờ xử lý`}
                      className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-[10px] font-bold text-white animate-pulse"
                    >
                      {badge}
                    </span>
                  )}
                </Link>
              );
            })}
            <button
              onClick={toggleSound}
              title={soundOn ? 'Tắt âm thanh báo' : 'Bật âm thanh báo'}
              className="ml-2 btn-ghost text-xs"
              aria-label={soundOn ? 'Tắt âm thanh báo' : 'Bật âm thanh báo'}
            >
              {soundOn ? <Volume2 className="h-3 w-3" /> : <VolumeX className="h-3 w-3" />}
            </button>
            <button
              onClick={async () => {
                await logout();
                navigate('/auth/login');
              }}
              className="ml-1 btn-ghost text-xs"
            >
              <LogOut className="h-3 w-3" /> Đăng xuất
            </button>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-4">
        <Outlet />
      </main>
    </div>
  );
}
