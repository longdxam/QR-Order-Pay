import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { api, generateIdempotencyKey, getErrorMessage, unwrap, vnd } from '../../lib/api';
import { useToast } from '../../components/ui/Toast';
import { EmptyState, ErrorState, useDocumentTitle } from '../../components/ui/EmptyState';

interface Table { _id: string; code: string; name: string; capacity: number; isActive: boolean }
interface SessionItem {
  session: {
    _id: string;
    status: 'OPEN' | 'CHECKOUT' | 'CLOSED';
    version: number;
    source?: 'STAFF' | 'GUEST';
    closedReason?: 'PAID' | 'STAFF' | 'IDLE' | null;
  };
  table: Table; orderCount: number;
}
interface Bill {
  total: number; paidAmount: number;
  orders: Array<{ _id: string; code: string; total: number; status: string; paymentStatus: string; items: Array<{ nameSnapshot: string; quantity: number; lineTotal: number }> }>;
}
export function StaffTables(): JSX.Element {
  useDocumentTitle('Bàn & phiên');
  const { toast } = useToast();
  const qc = useQueryClient();
  const sessions = useQuery({
    queryKey: ['staff-table-sessions'],
    queryFn: async () => unwrap(await api.get<{ items: SessionItem[] }>('/staff/table-sessions')),
    refetchInterval: 10_000,
  });
  const tables = useQuery({
    queryKey: ['staff-tables'],
    queryFn: async () => unwrap(await api.get<{ tables: Table[] }>('/staff/tables')),
  });
  const open = useMutation({
    mutationFn: (id: string) => api.post(`/staff/tables/${id}/sessions`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['staff-table-sessions'] }); toast({ title: 'Đã mở phiên bàn', tone: 'success' }); },
    onError: (e) => toast({ title: 'Chưa mở được bàn', description: getErrorMessage(e), tone: 'danger' }),
  });
  if (sessions.isLoading || tables.isLoading) return <p>Đang tải bàn...</p>;
  if (sessions.isError || tables.isError) return <ErrorState message={getErrorMessage(sessions.error ?? tables.error)} onRetry={() => { void sessions.refetch(); void tables.refetch(); }} />;
  const active = sessions.data?.items ?? [];
  const activeIds = new Set(active.map((s) => s.table._id));
  const empty = (tables.data?.tables ?? []).filter((t) => t.isActive && !activeIds.has(t._id));
  return <div className="space-y-6">
    <div><h1 className="font-display text-2xl font-semibold">Bàn & phiên phục vụ</h1><p className="text-sm text-muted-foreground">Mở bàn, kiểm tra món và xác nhận tiền đã nhận trước khi đóng phiên.</p></div>
    <section><h2 className="font-semibold mb-3">Bàn đang phục vụ ({active.length})</h2>
      {active.length === 0 ? <EmptyState title="Chưa có bàn đang phục vụ" description="Chọn một bàn trống để đón khách." /> :
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">{active.map((item) => <SessionCard key={item.session._id} item={item} />)}</div>}
    </section>
    <section><h2 className="font-semibold mb-3">Bàn trống ({empty.length})</h2><div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {empty.map((t) => <button className="card p-4 text-left" key={t._id} disabled={open.isPending} onClick={() => open.mutate(t._id)}>
        <p className="font-semibold">{t.name}</p><p className="text-sm text-muted-foreground">{t.capacity} chỗ</p><p className="mt-2 text-primary text-sm">Mở phiên →</p>
      </button>)}
    </div></section>
  </div>;
}
function SessionCard({ item }: { item: SessionItem }): JSX.Element {
  const { session, table } = item;
  const qc = useQueryClient();
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [method, setMethod] = useState('CASH');
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  const bill = useQuery({
    queryKey: ['staff-bill', session._id],
    queryFn: async () => unwrap(await api.get<Bill>(`/staff/table-sessions/${session._id}/bill`)),
    refetchInterval: 10_000,
  });
  const refresh = () => {
    for (const key of ['staff-table-sessions', 'staff-bill', 'staff-orders', 'staff-service-requests']) void qc.invalidateQueries({ queryKey: [key] });
  };
  const transition = useMutation({
    mutationFn: (status: 'OPEN' | 'CHECKOUT' | 'CLOSED') => api.patch(`/staff/table-sessions/${session._id}/status`, { status, expectedVersion: session.version }),
    onSuccess: refresh,
    onError: (e) => { refresh(); toast({ title: 'Chưa đổi được trạng thái', description: getErrorMessage(e), tone: 'danger' }); },
  });
  const payment = useMutation({
    mutationFn: async () => {
      if (!bill.data) throw new Error('Chưa tải được hóa đơn.');
      const payload = { amount: bill.data.total, method, expectedVersion: session.version };
      const signature = JSON.stringify(payload);
      if (attempt.current?.signature !== signature) attempt.current = { signature, key: generateIdempotencyKey() };
      return api.post(`/staff/table-sessions/${session._id}/payments`, payload, { headers: { 'Idempotency-Key': attempt.current.key } });
    },
    onSuccess: () => { setConfirmOpen(false); refresh(); toast({ title: 'Đã thu tiền và đóng phiên', tone: 'success' }); },
    onError: (e) => { refresh(); toast({ title: 'Chưa xác nhận được thanh toán', description: getErrorMessage(e), tone: 'danger' }); },
  });
  const pending = bill.data?.orders.some((o) => !['SERVED', 'CANCELLED'].includes(o.status)) ?? true;
  const unpaid = bill.data?.orders.filter((o) => o.status === 'SERVED' && o.paymentStatus === 'UNPAID') ?? [];
  const canCloseEmpty = bill.data && bill.data.orders.every((o) => o.paymentStatus === 'PAID' || o.status === 'CANCELLED');
  return <Card className="p-4 space-y-3">
    <div className="flex justify-between gap-2"><h3 className="font-semibold text-lg">{table.name}</h3><div className="flex items-center gap-2 shrink-0">{session.source === 'GUEST' ? <Badge tone="neutral">Tự mở</Badge> : null}<Badge tone={session.status === 'CHECKOUT' ? 'warning' : 'info'}>{session.status === 'CHECKOUT' ? 'Đang thanh toán' : 'Đang phục vụ'}</Badge></div></div>
    <p className="text-sm">{item.orderCount} đơn trong phiên</p>
    {bill.isError ? <ErrorState message={getErrorMessage(bill.error)} onRetry={() => bill.refetch()} /> : bill.isLoading ? <p>Đang tính tiền...</p> : <>
      <p className="font-semibold">Phải thu (món đã phục vụ): {vnd(bill.data!.total)}</p>
      {pending ? <p className="text-sm text-amber-700">Còn món chưa phục vụ. Hoàn tất món trước khi thu tiền.</p> : null}
    </>}
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={transition.isPending || payment.isPending} onClick={() => transition.mutate(session.status === 'OPEN' ? 'CHECKOUT' : 'OPEN')}>{session.status === 'OPEN' ? 'Chuyển thanh toán' : 'Mở lại gọi món'}</Button>
      <Button size="sm" disabled={session.status !== 'CHECKOUT' || pending || unpaid.length === 0 || bill.isError || payment.isPending} onClick={() => setConfirmOpen(true)}>Kiểm tra & thu tiền</Button>
      {canCloseEmpty ? <Button size="sm" variant="outline" disabled={transition.isPending} onClick={() => transition.mutate('CLOSED')}>Đóng phiên không còn nợ</Button> : null}
    </div>
    <Modal open={confirmOpen} onOpenChange={(open) => { if (!payment.isPending) setConfirmOpen(open); }} title={`Thanh toán · ${table.name}`}>
      <div className="space-y-4">
        {unpaid.map((o) => <div key={o._id} className="border-b pb-2"><p className="font-semibold">{o.code}</p>{o.items.map((it, i) => <p key={i} className="flex justify-between gap-3 text-sm"><span>{it.quantity} × {it.nameSnapshot}</span><span>{vnd(it.lineTotal)}</span></p>)}</div>)}
        <p className="text-lg font-semibold">Tổng phải thu: {vnd(bill.data?.total ?? 0)}</p>
        <label className="block text-sm">Phương thức thanh toán
          <select value={method} disabled={payment.isPending} onChange={(e) => setMethod(e.target.value)} className="mt-1 w-full border rounded p-2">
            <option value="CASH">Tiền mặt</option><option value="BANK_TRANSFER">Chuyển khoản — nhân viên kiểm tra</option><option value="OTHER">Khác</option>
          </select>
        </label>
        <p className="text-sm text-muted-foreground">Chỉ xác nhận sau khi đã nhận đủ tiền. Phiên sẽ đóng và khách có thể xem hóa đơn, gửi đánh giá.</p>
        <Button className="w-full" disabled={payment.isPending || pending || bill.isError} onClick={() => payment.mutate()}>{payment.isPending ? 'Đang xác nhận...' : 'Đã nhận đủ tiền — đóng phiên'}</Button>
      </div>
    </Modal>
  </Card>;
}
