import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api, getErrorMessage, unwrap, vnd } from '../../lib/api';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Skeleton';
import { ErrorState } from '../../components/ui/EmptyState';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';
import { useToast } from '../../components/ui/useToast';
import { getSocket } from '../../lib/socket';
import { ChevronRight, Eye } from 'lucide-react';
import { OrderDetailModal } from './OrderDetailModal';

interface OrderItem {
  productId: string;
  variantId: string | null;
  sizeName: string | null;
  sugarLevel: string;
  iceLevel: string;
  toppingIds: string[];
  toppingNamesSnapshot?: string[];
  note?: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  nameSnapshot: string;
}

interface Order {
  _id: string;
  code: string;
  tableSessionId: string;
  tableName: string;
  items: OrderItem[];
  total: number;
  status: 'PENDING' | 'CONFIRMED' | 'PREPARING' | 'READY' | 'SERVED' | 'CANCELLED';
  paymentStatus: 'UNPAID' | 'PAID' | 'REFUNDED';
  createdAt: string;
}

const COLUMNS: Array<{ status: Order['status']; label: string; next?: Order['status'] }> = [
  { status: 'PENDING', label: 'Chờ xác nhận', next: 'CONFIRMED' },
  { status: 'CONFIRMED', label: 'Đã nhận', next: 'PREPARING' },
  { status: 'PREPARING', label: 'Đang pha', next: 'READY' },
  { status: 'READY', label: 'Sẵn sàng', next: 'SERVED' },
];

export function StaffKDS(): JSX.Element {
  useDocumentTitle('KDS');
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [detailId, setDetailId] = useState<string | null>(null);

  const ordersQuery = useQuery({
    queryKey: ['staff-orders'],
    queryFn: async () => unwrap(await api.get<{ items: Order[] }>('/staff/orders')),
    refetchInterval: 10_000,
  });

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const handler = () => {
      queryClient.invalidateQueries({ queryKey: ['staff-orders'] });
    };
    socket.on('order.created', handler);
    socket.on('order.statusChanged', handler);
    return () => {
      socket.off('order.created', handler);
      socket.off('order.statusChanged', handler);
    };
  }, [queryClient]);

  const transition = useMutation({
    mutationFn: async (input: { id: string; status: Order['status'] }) =>
      unwrap(await api.patch(`/staff/orders/${input.id}/status`, { status: input.status })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff-orders'] });
    },
    onError: (err) => toast({ title: 'Không thể chuyển trạng thái', description: getErrorMessage(err), tone: 'danger' }),
  });

  const grouped = useMemo(() => {
    const map = new Map<Order['status'], Order[]>();
    for (const c of COLUMNS) map.set(c.status, []);
    if (ordersQuery.data?.items) {
      for (const o of ordersQuery.data.items) {
        const col = map.get(o.status);
        if (col) col.push(o);
      }
    }
    return map;
  }, [ordersQuery.data]);

  if (ordersQuery.isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-64" />
        ))}
      </div>
    );
  }

  if (ordersQuery.isError) {
    return <ErrorState message={getErrorMessage(ordersQuery.error)} onRetry={() => ordersQuery.refetch()} />;
  }

  return (
    <div className="space-y-3">
      <div>
        <h1 className="font-display text-2xl font-semibold">Kitchen Display</h1>
        <p className="text-sm text-muted-foreground">Đơn mới tự cập nhật. Kiểm tra số bàn và tùy chọn trước khi pha chế.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {COLUMNS.map((c) => {
          const items = grouped.get(c.status) ?? [];
          return (
            <div key={c.status} className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground">{c.label}</h2>
                <Badge>{items.length}</Badge>
              </div>
              {items.length === 0 ? (
                <Card className="p-3 text-center text-xs text-muted-foreground">Trống</Card>
              ) : (
                items.map((order) => <OrderCard key={order._id} order={order} busy={transition.isPending} nextStatus={c.next} onCancel={() => transition.mutate({ id: order._id, status: 'CANCELLED' })} onAdvance={() => transition.mutate({ id: order._id, status: c.next! })} onView={() => setDetailId(order._id)} />)
              )}
            </div>
          );
        })}
      </div>
      <OrderDetailModal orderId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}

function OrderCard({ order, nextStatus, onAdvance, onCancel, busy, onView }: { order: Order; nextStatus?: Order['status']; onAdvance: () => void; onCancel: () => void; busy: boolean; onView: () => void }): JSX.Element {
  const ageMin = Math.max(0, Math.round((Date.now() - new Date(order.createdAt).getTime()) / 60000));
  const isLate = ageMin > 10;
  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-display font-semibold">{order.code}</p>
          <p className="font-semibold text-primary">{order.tableName}</p>
          <p className="text-xs text-muted-foreground">{new Date(order.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</p>
        </div>
        <Badge tone={isLate ? 'danger' : 'info'}>{ageMin} phút</Badge>
      </div>
      <ul className="space-y-1 text-sm">
        {order.items.map((it, idx) => (
          <li key={idx} className="flex flex-col">
            <span className="font-medium">
              {it.quantity} x {it.nameSnapshot}
              {it.sizeName ? ` (${it.sizeName})` : ''}
            </span>
            <span className="text-xs text-muted-foreground">
              Đường {it.sugarLevel} · {labelIce(it.iceLevel)} · {vnd(it.lineTotal)}
            </span>
            {it.note ? <span className="text-xs italic text-accent">Ghi chú: {it.note}</span> : null}
            {it.toppingNamesSnapshot?.length ? <span className="text-xs">Topping: {it.toppingNamesSnapshot.join(', ')}</span> : null}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        {nextStatus ? (
          <Button onClick={onAdvance} disabled={busy} size="sm" className="flex-1">
            Chuyển sang {statusLabel(nextStatus)} <ChevronRight className="h-4 w-4" />
          </Button>
        ) : null}
        <Button variant="outline" size="sm" onClick={onView} title="Xem chi tiết">
          <Eye className="h-4 w-4" />
        </Button>
      </div>
      {['PENDING', 'CONFIRMED'].includes(order.status) ? <Button variant="outline" size="sm" disabled={busy} className="w-full" onClick={() => { if (window.confirm(`Hủy đơn ${order.code}?`)) onCancel(); }}>Hủy đơn</Button> : null}
    </Card>
  );
}

function statusLabel(s: Order['status']): string {
  switch (s) {
    case 'PENDING': return 'Chờ xác nhận';
    case 'CONFIRMED': return 'Đã nhận';
    case 'PREPARING': return 'Đang pha';
    case 'READY': return 'Sẵn sàng';
    case 'SERVED': return 'Đã phục vụ';
    case 'CANCELLED': return 'Đã huỷ';
  }
}

function labelIce(v: string): string {
  return v === 'no-ice' ? 'không đá' : v === 'less-ice' ? 'ít đá' : 'đá thường';
}
