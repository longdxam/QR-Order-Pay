import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays } from 'lucide-react';
import type { Reservation } from '@may-cafe/contracts';
import { api, unwrap, getErrorMessage } from '../../lib/api';
import { useAuth } from '../auth/useAuth';
import { useMember } from '../guest/useMember';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card } from '../../components/ui/Card';
import { ErrorState } from '../../components/ui/EmptyState';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';
import { useSocketEvent } from '../../lib/socket';
import { labels, readPending, vnTime } from './format';
import { ReservationForm } from './ReservationForm';
import { ReservationActions } from './ReservationActions';
export function ReservationsPage({
  staff = false,
  admin = false,
  mine = false,
}: {
  staff?: boolean;
  admin?: boolean;
  mine?: boolean;
}): JSX.Element {
  useDocumentTitle('Đặt bàn');
  const memberQuery = useMember(!staff),
    user = useAuth((s) => s.user),
    member = memberQuery.data?.member;
  if (!staff && memberQuery.isPending) return <p role="status">Đang tải tài khoản…</p>;
  if (!staff && memberQuery.isError)
    return (
      <ErrorState
        message={getErrorMessage(memberQuery.error)}
        onRetry={() => memberQuery.refetch()}
      />
    );
  if (!staff && !member)
    return (
      <Card className="mx-auto max-w-xl space-y-4 p-6">
        <CalendarDays className="h-9 w-9 text-primary" />
        <h1 className="g-display text-3xl">Hẹn một chỗ quen.</h1>
        <p className="text-sm text-muted-foreground">Đăng nhập để chọn bàn và giờ đến.</p>
        <Link
          to="/reservations/member"
          className="inline-block rounded-full bg-primary px-5 py-3 font-semibold text-primary-foreground"
        >
          Đăng nhập / Đăng ký
        </Link>
      </Card>
    );
  const identity = (staff ? user?.id : member?.id) ?? '';
  return (
    <ReservationWorkspace
      key={`${staff}:${identity}:${mine}`}
      identity={identity}
      staff={staff}
      admin={admin}
      mine={mine}
      name={member?.name ?? ''}
      phone={member?.phone ?? ''}
    />
  );
}
function ReservationWorkspace({
  identity,
  staff,
  admin,
  mine,
  name,
  phone,
}: {
  identity: string;
  staff: boolean;
  admin: boolean;
  mine: boolean;
  name: string;
  phone: string;
}): JSX.Element {
  const prefix = staff ? `/${admin ? 'admin' : 'staff'}/reservations` : '/reservations',
    qc = useQueryClient();
  const [creating, setCreating] = useState(
      !mine && (!staff || !!readPending(`reservation-pending:${prefix}:${identity}`)),
    ),
    [history, setHistory] = useState(false),
    [page, setPage] = useState(1),
    [date, setDate] = useState(''),
    [selected, setSelected] = useState<Reservation | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['reservations'] });
    void qc.invalidateQueries({ queryKey: ['reservation-availability'] });
    void qc.invalidateQueries({ queryKey: ['reservation-alerts'] });
  };
  useSocketEvent('reservation.changed', refresh);
  useSocketEvent('tableSession.statusChanged', refresh);
  useSocketEvent('connect', refresh);
  const query = useQuery({
    queryKey: ['reservations', prefix, identity, page, history, date],
    queryFn: async () =>
      unwrap<{ items: Reservation[]; total: number }>(
        await api.get(prefix, { params: { page, history, ...(date ? { date } : {}) } }),
      ),
    enabled: staff || mine,
    refetchInterval: 10000,
  });
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[.2em] text-primary">
            Fantastic Cafe
          </p>
          <h1 className="g-display text-3xl sm:text-4xl">
            {staff ? 'Lịch đặt bàn' : mine ? 'Lịch của tôi' : 'Một giờ thảnh thơi.'}
          </h1>
          {!staff ? (
            <p className="mt-2 text-sm text-muted-foreground">
              60 phút mỗi lượt · Giữ chỗ đến 15 phút sau giờ hẹn
            </p>
          ) : null}
        </div>
        {staff ? (
          <Button disabled={creating} onClick={() => setCreating(true)}>
            Đặt tại quầy
          </Button>
        ) : null}
      </div>
      {creating ? (
        <ReservationForm
          key={`${prefix}:${identity}`}
          storageKey={`reservation-pending:${prefix}:${identity}`}
          prefix={prefix}
          initialName={name}
          initialPhone={phone}
          onDone={() => {
            refresh();
            if (staff) setCreating(false);
          }}
        />
      ) : null}
      {staff || mine ? (
        <section className="space-y-4" aria-label="Danh sách lịch đặt">
          <div className="flex flex-wrap items-end gap-3">
            <Button
              variant={history ? 'outline' : 'primary'}
              onClick={() => {
                setHistory(false);
                setPage(1);
              }}
            >
              Đang xử lý
            </Button>
            <Button
              variant={history ? 'primary' : 'outline'}
              onClick={() => {
                setHistory(true);
                setPage(1);
              }}
            >
              Tất cả
            </Button>
            {staff ? (
              <label className="text-sm">
                Ngày đến
                <Input
                  type="date"
                  aria-label="Lọc ngày đến"
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setPage(1);
                  }}
                />
              </label>
            ) : null}
            <Button variant="ghost" onClick={refresh}>
              Tải lại
            </Button>
          </div>
          {query.isPending ? (
            <p role="status">Đang tải lịch đặt…</p>
          ) : query.isError ? (
            <ErrorState message={getErrorMessage(query.error)} onRetry={() => query.refetch()} />
          ) : (
            <>
              <p className="text-sm text-muted-foreground">{query.data.total} lịch đặt</p>
              {!query.data.items.length ? (
                <Card className="p-8 text-center text-muted-foreground">Chưa có lịch đặt.</Card>
              ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                  {query.data.items.map((r) => (
                    <Card key={r.id} className="space-y-4 p-5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <strong>
                          {r.tableName} · {r.partySize} khách
                        </strong>
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${r.status === 'CONFIRMED' ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}
                        >
                          {labels[r.status]}
                        </span>
                      </div>
                      <p className="text-lg font-semibold">{vnTime(r.startsAt)}</p>
                      <p className="text-sm text-muted-foreground">Đến {vnTime(r.endsAt)}</p>
                      <p className="text-sm">
                        {r.name} · {r.phone}
                      </p>
                      {r.note ? <p className="text-sm text-muted-foreground">{r.note}</p> : null}
                      {r.reason ? (
                        <p className="text-sm text-muted-foreground">{r.reason}</p>
                      ) : null}
                      {r.status === 'CHECKED_IN' ? (
                        <p className="text-sm text-muted-foreground">Quét QR tại bàn để gọi món.</p>
                      ) : null}
                      {r.status === 'CONFIRMED' ? (
                        <Button variant="outline" onClick={() => setSelected(r)}>
                          {staff ? 'Xử lý lịch đặt' : 'Hủy lịch đặt'}
                        </Button>
                      ) : null}
                      {staff && r.tableSessionId ? (
                        <Link
                          className="ml-3 text-sm underline"
                          to={admin ? '/admin/tables' : '/staff/tables'}
                        >
                          Bàn & phiên
                        </Link>
                      ) : null}
                    </Card>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-center gap-3">
                <Button variant="ghost" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                  Trước
                </Button>
                <span className="text-sm">Trang {page}</span>
                <Button
                  variant="ghost"
                  disabled={page * 30 >= query.data.total}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Sau
                </Button>
              </div>
            </>
          )}
        </section>
      ) : (
        <Link className="block text-center text-sm text-primary underline" to="/reservations/mine">
          Xem lịch của tôi
        </Link>
      )}
      {selected ? (
        <ReservationActions
          reservation={selected}
          prefix={prefix}
          staff={staff}
          onClose={() => setSelected(null)}
          onDone={() => {
            setSelected(null);
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}
