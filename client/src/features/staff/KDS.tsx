import { orderLabel } from '../../lib/recordLabels';
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
import { Link } from 'react-router-dom';
import { WalletCards } from 'lucide-react';
import { GiftLabel } from '../../components/GiftLabel';
import type { GiftDelivery } from '@may-cafe/contracts';
import type { FreestyleView } from '@may-cafe/contracts';
import { FreestyleRecipe } from '../../components/FreestyleRecipe';
import { RecentCancellations } from './RecentCancellations';

interface OrderItem {
  freestyle?: FreestyleView;
  hasCupPhoto?: boolean;
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
  gift?: GiftDelivery | null;
  fulfillmentType?: 'DINE_IN' | 'TAKEAWAY' | 'PICKUP';
  scheduledAt?: string | null;
  _id: string;
  code: string;
  tableSessionId: string;
  tableName: string;
  items: OrderItem[];
  total: number;
  status: 'PENDING' | 'CONFIRMED' | 'PREPARING' | 'READY' | 'SERVED' | 'CANCELLED';
  paymentStatus: 'UNPAID' | 'PAID' | 'REFUNDED';
  createdAt: string;
  version: number;
  statusHistory: Array<{ to: Order['status']; at: string }>;
}
interface CancelRequest {
  _id: string;
  reason: string;
  version: number;
  createdAt: string;
  orderId: {
    _id: string;
    code: string;
    createdAt?: string;
    tableId?: { name?: string } | null;
    status: string;
    paymentStatus: string;
    total: number;
    paidAmount?: number | null;
  };
}

const COLUMNS: Array<{ status: Order['status']; label: string; next?: Order['status'] }> = [
  { status: 'PENDING', label: 'Chờ xác nhận', next: 'CONFIRMED' },
  { status: 'CONFIRMED', label: 'Đã nhận', next: 'PREPARING' },
  { status: 'PREPARING', label: 'Đang pha', next: 'READY' },
  { status: 'READY', label: 'Sẵn sàng', next: 'SERVED' },
];
const LATE_AFTER_MINUTES: Partial<Record<Order['status'], number>> = {
  PENDING: 5,
  CONFIRMED: 5,
  PREPARING: 10,
  READY: 5,
};

export function StaffKDS(): JSX.Element {
  useDocumentTitle('KDS');
  const queryClient = useQueryClient();
  const awaiting = useQuery({
    queryKey: ['staff-awaiting-payments'],
    queryFn: async () =>
      unwrap<{ items: Array<{ _id: string }> }>(await api.get('/staff/awaiting-payments')),
    refetchInterval: 5_000,
  });
  const { toast } = useToast();
  const [detailId, setDetailId] = useState<string | null>(null);
  const [, setClock] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setClock((value) => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const ordersQuery = useQuery({
    queryKey: ['staff-orders'],
    queryFn: async () => unwrap(await api.get<{ items: Order[] }>('/staff/orders')),
    refetchInterval: 10_000,
  });
  const cancelRequests = useQuery({
    queryKey: ['staff-cancel-requests'],
    queryFn: async () =>
      unwrap<{ items: CancelRequest[] }>(await api.get('/staff/cancel-requests')),
    refetchInterval: 8_000,
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
    onError: (err) =>
      toast({
        title: 'Không thể chuyển trạng thái',
        description: getErrorMessage(err),
        tone: 'danger',
      }),
  });
  const refund = useMutation({
    mutationFn: (order: Order) =>
      api.post(`/staff/orders/${order._id}/refund`, {
        expectedVersion: order.version,
        amount: order.total,
        method: 'CASH',
        reason: 'Nhân viên đã hoàn đủ tiền mặt và hủy đơn trước pha chế',
        refundConfirmed: true,
      }),
    onSuccess: () => {
      for (const key of ['staff-orders', 'staff-cancel-requests', 'staff-bill', 'cash-shift'])
        void queryClient.invalidateQueries({ queryKey: [key] });
      toast({ title: 'Đã ghi nhận hoàn tiền và hủy đơn', tone: 'success' });
    },
    onError: (error) =>
      toast({
        title: 'Chưa ghi nhận được hoàn tiền',
        description: getErrorMessage(error),
        tone: 'danger',
      }),
  });
  const decideCancel = useMutation({
    mutationFn: ({
      request,
      decision,
    }: {
      request: CancelRequest;
      decision: 'APPROVED' | 'REJECTED';
    }) =>
      api.patch(`/staff/cancel-requests/${request._id}`, {
        decision,
        expectedVersion: request.version,
        ...(decision === 'APPROVED' &&
        (request.orderId.paymentStatus === 'PAID' || (request.orderId.paidAmount ?? 0) > 0)
          ? { refundConfirmed: true, refundMethod: 'CASH' }
          : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['staff-cancel-requests'] });
      void queryClient.invalidateQueries({ queryKey: ['staff-orders'] });
    },
    onError: (error) =>
      toast({
        title: 'Không thể xử lý yêu cầu hủy',
        description: getErrorMessage(error),
        tone: 'danger',
      }),
  });

  const grouped = useMemo(() => {
    const map = new Map<Order['status'], Order[]>();
    for (const c of COLUMNS) map.set(c.status, []);
    if (ordersQuery.data?.items) {
      for (const o of ordersQuery.data.items) {
        const col = map.get(o.status);
        if (col) col.push(o);
      }
      for (const orders of map.values())
        orders.sort((left, right) => stageStartedAt(left) - stageStartedAt(right));
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
    return (
      <ErrorState
        message={getErrorMessage(ordersQuery.error)}
        onRetry={() => ordersQuery.refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold">Kitchen Display</h1>
        </div>
        {(awaiting.data?.items.length ?? 0) > 0 ? (
          <Link
            to="/staff/tables#awaiting-payments"
            className="inline-flex items-center gap-2 text-sm font-semibold text-primary underline underline-offset-4"
          >
            <WalletCards className="h-5 w-5 text-primary" />
            Thu tiền tại Bàn & phiên
            {awaiting.data ? <Badge tone="warning">{awaiting.data.items.length}</Badge> : null}
          </Link>
        ) : null}
      </div>
      {cancelRequests.isError ? (
        <ErrorState
          message={getErrorMessage(cancelRequests.error)}
          onRetry={() => cancelRequests.refetch()}
        />
      ) : null}
      {(cancelRequests.data?.items.length ?? 0) > 0 ? (
        <Card className="border-warning/50 p-3">
          <h2 className="font-display font-semibold">Yêu cầu hủy đang chờ</h2>
          <div className="mt-2 space-y-2">
            {cancelRequests.data!.items.map((request) => (
              <div
                key={request._id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-warning/10 p-2 text-sm"
              >
                <span>
                  <strong>
                    {orderLabel({
                      tableName: request.orderId.tableId?.name,
                      createdAt: request.orderId.createdAt,
                    })}
                  </strong>{' '}
                  · {request.reason}
                </span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={decideCancel.isPending}
                    onClick={() => decideCancel.mutate({ request, decision: 'REJECTED' })}
                  >
                    Từ chối
                  </Button>
                  <Button
                    size="sm"
                    disabled={decideCancel.isPending}
                    onClick={() => {
                      if (
                        (request.orderId.paymentStatus !== 'PAID' &&
                          (request.orderId.paidAmount ?? 0) === 0) ||
                        window.confirm(
                          `Chỉ tiếp tục sau khi đã hoàn ${vnd(request.orderId.paidAmount ?? request.orderId.total)} bằng TIỀN MẶT cho khách. Xác nhận đã hoàn đủ tiền?`,
                        )
                      )
                        decideCancel.mutate({ request, decision: 'APPROVED' });
                    }}
                  >
                    {request.orderId.paymentStatus === 'PAID' ||
                    (request.orderId.paidAmount ?? 0) > 0
                      ? 'Đã hoàn tiền mặt & duyệt hủy'
                      : 'Duyệt hủy'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((c, index) => {
          const items = grouped.get(c.status) ?? [];
          return (
            <section
              key={c.status}
              aria-label={c.label}
              className="min-w-0 rounded-2xl border border-border bg-muted/35 p-3"
            >
              <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 rounded-full ${index === 0 ? 'bg-accent' : 'bg-primary'}`}
                  />
                  {c.label}
                </h2>
                <Badge className="tabular-nums" tone={items.length ? 'info' : 'neutral'}>
                  {items.length}
                </Badge>
              </div>
              {items.length === 0 ? (
                <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-control p-6 text-sm text-muted-foreground lg:min-h-64">
                  Trống
                </div>
              ) : (
                <div className="space-y-3">
                  {items.map((order) => (
                    <OrderCard
                      key={order._id}
                      order={order}
                      busy={transition.isPending || refund.isPending || decideCancel.isPending}
                      nextStatus={c.next}
                      onCancel={() => {
                        if (order.paymentStatus === 'PAID') {
                          if (
                            window.confirm(
                              `Chỉ xác nhận sau khi đã hoàn ${vnd(order.total)} bằng TIỀN MẶT. Hủy đơn ${orderLabel(order)} và ghi nhận đã hoàn đủ tiền?`,
                            )
                          )
                            refund.mutate(order);
                        } else transition.mutate({ id: order._id, status: 'CANCELLED' });
                      }}
                      onAdvance={() => transition.mutate({ id: order._id, status: c.next! })}
                      onView={() => setDetailId(order._id)}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
      <details className="rounded-2xl border border-border p-4">
        <summary className="cursor-pointer text-sm font-semibold">Lịch sử đơn đã hủy</summary>
        <div className="mt-4">
          <RecentCancellations />
        </div>
      </details>
      <OrderDetailModal orderId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}

function OrderCard({
  order,
  nextStatus,
  onAdvance,
  onCancel,
  busy,
  onView,
}: {
  order: Order;
  nextStatus?: Order['status'];
  onAdvance: () => void;
  onCancel: () => void;
  busy: boolean;
  onView: () => void;
}): JSX.Element {
  const ageMin = Math.max(0, Math.floor((Date.now() - stageStartedAt(order)) / 60000));
  const threshold = LATE_AFTER_MINUTES[order.status] ?? 10;
  const isLate = ageMin >= threshold;
  const placedAt = new Date(order.createdAt).toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh',
  });
  return (
    <Card className={`overflow-hidden p-0 ${isLate ? 'border-danger/60' : ''}`}>
      <div className="flex items-start justify-between gap-3 px-4 pb-2 pt-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="font-display text-lg font-semibold leading-tight">
            {order.gift ? `Bàn trả tiền: ${order.tableName}` : order.tableName}
          </p>
          <p className="text-xs text-muted-foreground">Đặt lúc {placedAt}</p>
          {order.items.some((i) => i.hasCupPhoto) && (
            <Link to="/staff/cup-prints" className="text-xs font-semibold underline">
              Có ảnh · Mở thiết kế cốc
            </Link>
          )}
          {order.scheduledAt ? (
            <p className="text-xs">
              Hẹn{' '}
              {new Date(order.scheduledAt).toLocaleString('vi-VN', {
                timeZone: 'Asia/Ho_Chi_Minh',
              })}
            </p>
          ) : null}
        </div>
        <Badge
          className="shrink-0 whitespace-nowrap tabular-nums"
          tone={isLate ? 'danger' : 'info'}
        >
          {isLate ? `Quá hạn ${ageMin}′` : `${ageMin} phút`}
        </Badge>
      </div>
      {order.gift ? (
        <div className="px-4 pb-2">
          <GiftLabel gift={order.gift} />
        </div>
      ) : null}
      <ul className="divide-y divide-border border-y border-border">
        {order.items.map((it, idx) => {
          const modifiers = itemModifiers(it.sugarLevel, it.iceLevel);
          return (
            <li key={idx} className="flex gap-3 px-4 py-2.5">
              <span className="mt-0.5 inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md bg-muted px-1.5 text-xs font-bold tabular-nums">
                {it.quantity}×
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-sm font-semibold leading-snug">
                  {it.nameSnapshot}
                  {it.sizeName ? (
                    <span className="ml-1 font-normal text-muted-foreground">· {it.sizeName}</span>
                  ) : null}
                </p>
                {modifiers.length || it.toppingNamesSnapshot?.length ? (
                  <div className="flex flex-wrap gap-1">
                    {modifiers.map((m) => (
                      <span
                        key={m}
                        className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium"
                      >
                        {m}
                      </span>
                    ))}
                    {it.toppingNamesSnapshot?.map((t) => (
                      <span
                        key={t}
                        className="rounded-full border border-border px-2 py-0.5 text-[11px]"
                      >
                        + {t}
                      </span>
                    ))}
                  </div>
                ) : null}
                {it.note ? (
                  <p className="rounded-md bg-warning/10 px-2 py-1 text-xs italic">“{it.note}”</p>
                ) : null}
                <FreestyleRecipe value={it.freestyle} />
              </div>
            </li>
          );
        })}
      </ul>
      <div className="space-y-1.5 px-4 py-3">
        <div className="flex gap-2">
          {nextStatus ? (
            <Button
              onClick={onAdvance}
              disabled={busy}
              size="sm"
              className="flex-1 whitespace-nowrap"
              aria-label={`Chuyển sang ${nextStatus === 'SERVED' && order.fulfillmentType && order.fulfillmentType !== 'DINE_IN' ? 'Khách đã nhận' : statusLabel(nextStatus)}`}
            >
              {nextStatus === 'SERVED' &&
              order.fulfillmentType &&
              order.fulfillmentType !== 'DINE_IN'
                ? 'Khách đã nhận'
                : statusLabel(nextStatus)}
              <ChevronRight className="h-4 w-4 shrink-0" />
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={onView}
            title="Xem chi tiết"
            aria-label="Xem chi tiết đơn"
          >
            <Eye className="h-4 w-4" />
          </Button>
        </div>
        {['PENDING', 'CONFIRMED'].includes(order.status) ? (
          <button
            type="button"
            disabled={busy}
            className="w-full rounded-full py-1 text-xs font-semibold text-danger hover:bg-danger/10 disabled:opacity-50"
            title={
              order.paymentStatus === 'PAID'
                ? 'Chỉ dùng sau khi đã hoàn tiền mặt cho khách'
                : undefined
            }
            onClick={() => {
              if (window.confirm(`Hủy đơn ${orderLabel(order)}?`)) onCancel();
            }}
          >
            {order.paymentStatus === 'PAID' ? 'Hủy đơn · đã hoàn tiền' : 'Hủy đơn'}
          </button>
        ) : null}
      </div>
    </Card>
  );
}

/** Only the choices that differ from the standard recipe, so the barista sees what to change. */
function itemModifiers(sugar: string, ice: string): string[] {
  const out: string[] = [];
  if (sugar && sugar !== '50%' && sugar !== 'Theo công thức') out.push(`Đường ${sugar}`);
  if (ice === 'no-ice' || ice === 'less-ice') {
    const label = labelIce(ice);
    out.push(label.charAt(0).toUpperCase() + label.slice(1));
  }
  return out;
}

function stageStartedAt(order: Order): number {
  const entry = [...(order.statusHistory ?? [])]
    .reverse()
    .find((value) => value.to === order.status);
  const stageAt = new Date(entry?.at ?? order.createdAt).getTime();
  return order.scheduledAt && ['PENDING', 'CONFIRMED'].includes(order.status)
    ? Math.max(stageAt, new Date(order.scheduledAt).getTime() - 15 * 60000)
    : stageAt;
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

function labelIce(v: string): string {
  if (v === 'Theo công thức') return v;
  return v === 'no-ice' ? 'không đá' : v === 'less-ice' ? 'ít đá' : 'đá thường';
}
