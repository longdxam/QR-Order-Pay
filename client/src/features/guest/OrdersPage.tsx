import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ListChecks, ReceiptText, BellRing } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { api, getErrorMessage, unwrap, vnd } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { EmptyState, ErrorState, useDocumentTitle } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getSocket } from '../../lib/socket';

interface OrderItem {
  productId: string;
  variantId: string | null;
  sizeName: string | null;
  sugarLevel: string;
  iceLevel: string;
  toppingIds: string[];
  note?: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  nameSnapshot: string;
}

interface Order {
  _id: string;
  code: string;
  items: OrderItem[];
  total: number;
  status: 'PENDING' | 'CONFIRMED' | 'PREPARING' | 'READY' | 'SERVED' | 'CANCELLED';
  paymentStatus: 'UNPAID' | 'PAID' | 'REFUNDED';
  createdAt: string;
  statusHistory: Array<{ from: string | null; to: string; at: string }>;
}

const STATUS_FLOW = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED'] as const;

export function OrdersPage(): JSX.Element {
  useDocumentTitle('Đơn của tôi');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const ordersQuery = useQuery({
    queryKey: ['my-orders'],
    queryFn: async () => unwrap(await api.get<{ orders: Order[] }>('/orders/mine')),
    refetchInterval: 15_000,
  });

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const handler = () => {
      queryClient.invalidateQueries({ queryKey: ['my-orders'] });
      toast({ title: 'Đơn của bạn vừa cập nhật', tone: 'info' });
    };
    socket.on('order.statusChanged', handler);
    socket.on('payment.confirmed', handler);
    return () => {
      socket.off('order.statusChanged', handler);
      socket.off('payment.confirmed', handler);
    };
  }, [queryClient, toast]);

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => unwrap(await api.post(`/orders/${id}/cancel`)),
    onSuccess: () => {
      toast({ title: 'Đã huỷ đơn', tone: 'success' });
      queryClient.invalidateQueries({ queryKey: ['my-orders'] });
    },
    onError: (err) => toast({ title: 'Không thể huỷ', description: getErrorMessage(err), tone: 'danger' }),
  });

  const requestBill = useMutation({
    mutationFn: async () => {
      // No dedicated endpoint yet; trigger service request to ask for bill.
      await api.post('/service-requests', { type: 'REQUEST_BILL' });
    },
    onSuccess: () => toast({ title: 'Đã gửi yêu cầu thanh toán', description: 'Nhân viên sẽ đến hỗ trợ.', tone: 'success' }),
    onError: (err) => toast({ title: 'Không gửi được yêu cầu', description: getErrorMessage(err), tone: 'danger' }),
  });

  if (ordersQuery.isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
    );
  }

  if (ordersQuery.isError) {
    return <ErrorState message={getErrorMessage(ordersQuery.error)} onRetry={() => ordersQuery.refetch()} />;
  }

  const orders = ordersQuery.data?.orders ?? [];
  if (orders.length === 0) {
    return (
      <EmptyState
        title="Bạn chưa có đơn nào"
        description="Khi gửi đơn, tiến độ sẽ hiển thị tại đây."
        icon={<ListChecks className="h-6 w-6" />}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold">Đơn của bạn</h1>
        <Button variant="outline" onClick={() => requestBill.mutate()} disabled={requestBill.isPending}>
          <ReceiptText className="h-4 w-4" /> Yêu cầu thanh toán
        </Button>
      </div>

      {orders.map((order) => (
        <Card key={order._id} className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm text-muted-foreground">Mã đơn</p>
              <p className="font-display text-lg font-semibold">{order.code}</p>
            </div>
            <Badge tone={order.status === 'CANCELLED' ? 'danger' : order.status === 'SERVED' ? 'success' : 'info'}>
              {statusLabel(order.status)}
            </Badge>
          </div>

          <ul className="space-y-1 text-sm">
            {order.items.map((it, idx) => (
              <li key={`${order._id}-${idx}`} className="flex justify-between">
                <span>
                  {it.quantity} x {it.nameSnapshot}
                  {it.sizeName ? ` (${it.sizeName})` : ''}
                </span>
                <span className="text-muted-foreground">{vnd(it.lineTotal)}</span>
              </li>
            ))}
          </ul>

          <div className="flex justify-between text-sm font-semibold">
            <span>Tổng</span>
            <span>{vnd(order.total)}</span>
          </div>

          <Timeline status={order.status} paymentStatus={order.paymentStatus} />

          {order.status === 'PENDING' ? (
            <Button variant="outline" onClick={() => cancelMutation.mutate(order._id)} disabled={cancelMutation.isPending}>
              <BellRing className="h-4 w-4" /> Huỷ đơn
            </Button>
          ) : null}
        </Card>
      ))}
    </div>
  );
}

function statusLabel(s: Order['status']): string {
  switch (s) {
    case 'PENDING':
      return 'Chờ xác nhận';
    case 'CONFIRMED':
      return 'Đã nhận';
    case 'PREPARING':
      return 'Đang pha';
    case 'READY':
      return 'Sẵn sàng';
    case 'SERVED':
      return 'Đã phục vụ';
    case 'CANCELLED':
      return 'Đã huỷ';
  }
}

function Timeline({ status, paymentStatus }: { status: Order['status']; paymentStatus: Order['paymentStatus'] }): JSX.Element {
  const steps = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED'] as const;
  const reached = status === 'CANCELLED' ? 0 : steps.indexOf(status as typeof steps[number]) + 1;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        {steps.map((s) => (
          <span key={s} className={steps.indexOf(s) < reached ? 'text-primary font-medium' : ''}>
            {statusLabel(s)}
          </span>
        ))}
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: status === 'CANCELLED' ? '0%' : `${(reached / steps.length) * 100}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Thanh toán: {paymentStatus === 'PAID' ? 'Đã thanh toán' : 'Chưa thanh toán'}
      </p>
    </div>
  );
}
