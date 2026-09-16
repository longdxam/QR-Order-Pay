import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { Coffee, ShoppingCart, ListChecks, Sparkles, LogOut, Wifi, WifiOff, BellRing, ReceiptText } from 'lucide-react';
import { useCart, cartTotals } from '../store/cart';
import { api, unwrap, vnd, getErrorMessage } from '../lib/api';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { connectGuestSocket, disconnectSocket, useSocketEvent } from '../lib/socket';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/Toast';

export interface CurrentSession {
  active: boolean;
  receiptAvailable?: boolean;
  tableSessionId?: string;
  participantId?: string;
  status?: 'OPEN' | 'CHECKOUT';
  table?: { code: string; name: string };
}

export function GuestLayout(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const items = useCart((s) => s.items);
  const setSession = useCart((s) => s.setSession);
  const resetSession = useCart((s) => s.resetSession);
  const { count, subtotal } = cartTotals(items);
  const [connected, setConnected] = useState(false);
  const sessionQuery = useQuery({
    queryKey: ['guest-session'],
    queryFn: async () => unwrap(await api.get<CurrentSession>('/table-sessions/current')),
    refetchInterval: 10_000,
  });
  const session = sessionQuery.data;
  const refreshSession = () => { void qc.invalidateQueries({ queryKey: ['guest-session'] }); };
  const refreshOrders = () => { void qc.invalidateQueries({ queryKey: ['my-orders'] }); };
  useSocketEvent('connect', () => { setConnected(true); refreshSession(); refreshOrders(); void qc.invalidateQueries({ queryKey: ['menu'] }); });
  useSocketEvent('disconnect', () => { setConnected(false); refreshSession(); });
  useSocketEvent('order.statusChanged', refreshOrders);
  useSocketEvent('order.created', refreshOrders);
  useSocketEvent('menu.availabilityChanged', () => { void qc.invalidateQueries({ queryKey: ['menu'] }); });
  useSocketEvent('tableSession.statusChanged', refreshSession);
  useSocketEvent('payment.confirmed', () => { refreshSession(); void qc.invalidateQueries({ queryKey: ['receipt'] }); navigate('/receipt'); });
  useSocketEvent('serviceRequest.resolved', () => toast({ title: 'Nhân viên đã xử lý yêu cầu của bạn', tone: 'success' }));

  useEffect(() => {
    if (session?.active && session.tableSessionId && session.participantId) setSession(session.tableSessionId, session.participantId);
    else if (session && !session.active) {
      resetSession();
      if (session.receiptAvailable && location.pathname !== '/receipt') navigate('/receipt', { replace: true });
    }
  }, [session, setSession, resetSession, navigate, location.pathname]);

  useEffect(() => {
    if (!session?.active || !session.participantId) return;
    const socket = connectGuestSocket(session.participantId);
    setConnected(socket.connected);
    return () => { disconnectSocket(); setConnected(false); };
  }, [session?.active, session?.participantId]);

  const callStaff = useMutation({
    mutationFn: () => api.post('/service-requests', { type: 'CALL_STAFF' }),
    onSuccess: () => toast({ title: 'Đã gọi nhân viên', description: 'Nhân viên sẽ đến hỗ trợ bạn.', tone: 'success' }),
    onError: (e) => toast({ title: 'Chưa gửi được yêu cầu', description: getErrorMessage(e), tone: 'danger' }),
  });
  const leave = useMutation({
    mutationFn: () => api.post('/table-sessions/leave'),
    onSuccess: () => { disconnectSocket(); resetSession(); qc.removeQueries({ queryKey: ['my-orders'] }); qc.removeQueries({ queryKey: ['receipt'] }); qc.setQueryData(['guest-session'], { active: false }); navigate('/t'); },
    onError: (e) => toast({ title: 'Chưa rời được bàn', description: getErrorMessage(e), tone: 'danger' }),
  });

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-30 bg-background/95 border-b border-foreground/5 print:hidden">
        <div className="mx-auto max-w-5xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Coffee className="h-7 w-7 text-primary" />
            <div><p className="font-display font-semibold">Mây Café</p>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                {session?.table?.name ?? (session?.receiptAvailable ? 'Đã kết thúc phiên' : 'Chưa vào bàn')}
                {session?.status === 'CHECKOUT' ? ' · Đang thanh toán' : ''}
              </p>
            </div>
          </div>
          <nav className="flex gap-1">
            <NavTab to="/menu" label="Menu" icon={<Coffee className="h-4 w-4" />} />
            <NavTab to="/ai" label="AI" icon={<Sparkles className="h-4 w-4" />} />
            <NavTab to={session?.receiptAvailable ? '/receipt' : '/orders'} label={session?.receiptAvailable ? 'Hóa đơn' : 'Đơn'} icon={session?.receiptAvailable ? <ReceiptText className="h-4 w-4" /> : <ListChecks className="h-4 w-4" />} />
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-4 pb-40 print:pb-0"><Outlet /></main>
      <footer className="fixed bottom-0 inset-x-0 z-30 border-t bg-card safe-bottom print:hidden">
        <div className="mx-auto max-w-5xl px-4 py-3 space-y-3">
          {count > 0 && session?.active ? <div className="flex items-center justify-between gap-2">
            <div><p className="text-xs">Giỏ hàng ({count} món)</p><p className="font-semibold">{vnd(subtotal)}</p></div>
            <Button onClick={() => navigate('/cart')} disabled={session.status !== 'OPEN'}><ShoppingCart className="h-4 w-4" /> Xem giỏ</Button>
          </div> : null}
          <div className="flex justify-between items-center gap-2">
            {session?.active ? <Button size="sm" variant="outline" onClick={() => callStaff.mutate()} disabled={callStaff.isPending}><BellRing className="h-4 w-4" /> Gọi nhân viên</Button> : <Button size="sm" variant="outline" onClick={() => navigate('/t')}>Vào bàn</Button>}
            <Button size="sm" variant="ghost" onClick={() => leave.mutate()} disabled={leave.isPending}><LogOut className="h-4 w-4" /> Rời bàn</Button>
          </div>
        </div>
      </footer>
    </div>
  );
}

function NavTab({ to, label, icon }: { to: string; label: string; icon: JSX.Element }): JSX.Element {
  return <NavLink to={to} className={({ isActive }) => `flex items-center gap-1 rounded-full px-3 py-2 text-xs ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>{icon}{label}</NavLink>;
}
