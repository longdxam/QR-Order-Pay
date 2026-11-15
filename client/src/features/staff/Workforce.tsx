import { useState, useCallback, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3 } from 'lucide-react';
import { z } from 'zod';
import type { WorkShiftDto, WorkforceWeek } from '@may-cafe/contracts';
import { api, unwrap, getErrorMessage, getAxiosError } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { ErrorState } from '../../components/ui/EmptyState';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';
import { useAuth } from '../auth/useAuth';
import { useSocketEvent } from '../../lib/socket';
import { WorkforceCopyModal, WorkforceExportButton, WorkforceCashPanel } from './WorkforceExtras';
import {
  DAY,
  editorWrite,
  monday,
  newRequestId,
  shiftWeek,
  stamp,
  vnDate,
  type Editor,
  type Write,
} from './workforce/format';
import { ScheduleGrid } from './workforce/ScheduleGrid';
import { CoveragePanel } from './workforce/CoveragePanel';
import { MetricsTable } from './workforce/MetricsTable';
import { EditorModal, Retry } from './workforce/EditorModal';

type Tab = 'schedule' | 'metrics' | 'coverage' | 'cash';
const TABS: Array<{ id: Tab; label: string; adminOnly?: boolean }> = [
  { id: 'schedule', label: 'Lịch & chấm công' },
  { id: 'metrics', label: 'Hiệu suất' },
  { id: 'coverage', label: 'Nhu cầu nhân sự', adminOnly: true },
  { id: 'cash', label: 'Đối soát ca thu ngân', adminOnly: true },
];

/**
 * Lịch ca theo tuần. Staff xem lịch của mình và chấm công; Admin xếp/sửa/hủy ca, điều chỉnh chấm
 * công, cấu hình nhu cầu nhân sự và xem hiệu suất/đối soát. Mọi ghi đều qua một mutation duy nhất để
 * giữ lại yêu cầu khi chưa rõ kết quả (mạng/5xx) và cho thử lại nguyên văn.
 */
export function Workforce({ admin = false }: { admin?: boolean }): JSX.Element {
  useDocumentTitle(admin ? 'Lịch ca & hiệu suất' : 'Lịch làm & chấm công');
  const qc = useQueryClient();
  const userId = useAuth((state) => state.user?.id);
  const [from, setFrom] = useState(monday);
  const [tab, setTab] = useState<Tab>('schedule');
  const [copyRequestId, setCopyRequestId] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState<Write | null>(null);
  const [message, setMessage] = useState('');
  const query = useQuery({
    queryKey: ['workforce', admin, userId, from],
    queryFn: async () =>
      unwrap<WorkforceWeek>(
        await api.get(`${admin ? '/admin' : '/staff'}/workforce`, { params: { from } }),
      ),
    refetchInterval: 30000,
  });
  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['workforce'] });
  }, [qc]);
  useSocketEvent('workforce.changed', refresh);
  useSocketEvent('order.statusChanged', refresh);
  useSocketEvent('connect', refresh);
  const save = useMutation({
    mutationFn: async (write: Write) => api[write.method](write.url, write.body),
    onSuccess: (result, write) => {
      const updated = unwrap<{ shift?: WorkShiftDto }>(result).shift;
      // Ca vừa xếp/sửa nằm ngoài tuần đang xem thì chuyển sang tuần chứa nó.
      if (admin && updated && /^\/admin\/workforce\/shifts(?:\/[^/]+)?$/.test(write.url)) {
        const start = Date.parse(`${from}T00:00:00+07:00`);
        if (Date.parse(updated.startsAt) >= start + 7 * DAY || Date.parse(updated.endsAt) <= start)
          setFrom(vnDate(new Date(updated.startsAt)));
        setTab('schedule');
      }
      setUncertain(null);
      setEditor(null);
      setError('');
      setMessage('Đã ghi nhận.');
      refresh();
    },
    onError: (err, write) => {
      const status = getAxiosError(err)?.response?.status;
      setUncertain(!status || status >= 500 ? write : null);
      setError(getErrorMessage(err));
      refresh();
    },
  });
  const data = query.data;
  const busy = save.isPending || !!uncertain;
  function open(next: Editor) {
    setEditor(next);
    setError('');
    setMessage('');
  }
  function send(write: Write) {
    setError('');
    setMessage('');
    save.mutate(write);
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editor || !data) return;
    const ruleCount = e.currentTarget.querySelectorAll('[data-rule]').length;
    try {
      send(editorWrite(editor, new FormData(e.currentTarget), ruleCount));
    } catch (err) {
      setError(
        err instanceof z.ZodError
          ? (err.issues[0]?.message ?? 'Kiểm tra lại thông tin.')
          : 'Kiểm tra lại ngày và giờ.',
      );
    }
  }
  function clock(shift: WorkShiftDto, direction: 'in' | 'out') {
    send({
      method: 'post',
      url: `/staff/workforce/${shift.id}/clock-${direction}`,
      body: { expectedVersion: shift.version },
    });
  }
  const current = data?.currentShift;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Nhân sự · Giờ Việt Nam (UTC+7)</p>
          <h1 className="font-display text-3xl">
            {admin ? 'Lịch ca & hiệu suất' : 'Lịch làm & chấm công'}
          </h1>
        </div>
        {admin ? (
          <Button
            disabled={busy || !data}
            onClick={() => open({ kind: 'schedule', shift: null, requestId: newRequestId() })}
          >
            <CalendarDays className="mr-2 h-4 w-4" />
            Xếp ca
          </Button>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">
        Vào ca từ 30 phút trước giờ bắt đầu. Trễ được tính sau 5 phút. Giờ làm chỉ cộng khi đã ra
        ca; quên chấm công cần quản lý điều chỉnh.
      </p>
      {!admin && current ? (
        <section
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary bg-primary/5 p-5"
          aria-label="Ca đang làm"
        >
          <div>
            <p className="font-semibold">
              <Clock3 className="mr-2 inline h-5 w-5" />
              Đang làm · {current.label}
            </p>
            <p className="text-sm">
              Vào lúc {stamp(current.effectiveInAt!)} · Lịch {stamp(current.startsAt)} –{' '}
              {stamp(current.endsAt)}
            </p>
          </div>
          <Button disabled={busy} onClick={() => clock(current, 'out')}>
            Ra ca
          </Button>
        </section>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label="Tuần trước"
          disabled={busy}
          onClick={() => setFrom(shiftWeek(from, -1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <label className="text-sm">
          Tuần từ
          <Input
            type="date"
            value={from}
            disabled={busy}
            onChange={(e) => {
              if (e.target.value) setFrom(e.target.value);
            }}
          />
        </label>
        <Button
          variant="outline"
          size="icon"
          aria-label="Tuần sau"
          disabled={busy}
          onClick={() => setFrom(shiftWeek(from, 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => setFrom(monday())}>
          Tuần này
        </Button>
        <Button
          variant="outline"
          disabled={save.isPending}
          onClick={() => {
            setError('');
            void query.refetch();
          }}
        >
          Tải lại
        </Button>
        {admin ? (
          <Button
            variant="outline"
            disabled={busy || !data}
            onClick={() => setCopyRequestId(newRequestId())}
          >
            Sao chép lịch tuần
          </Button>
        ) : null}
        <WorkforceExportButton admin={admin} from={from} disabled={busy || !data} />
      </div>
      <div className="flex flex-wrap gap-2" aria-label="Nội dung nhân sự">
        {TABS.filter((item) => admin || !item.adminOnly).map((item) => (
          <Button
            key={item.id}
            variant={tab === item.id ? 'primary' : 'outline'}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </Button>
        ))}
      </div>
      {message ? (
        <p role="status" className="text-success">
          {message}
        </p>
      ) : null}
      {!editor && error ? (
        <p role="alert" className="text-danger">
          {error}
        </p>
      ) : null}
      {!editor && uncertain ? (
        <Retry write={uncertain} pending={save.isPending} onRetry={send} />
      ) : null}
      {query.isError ? (
        <ErrorState message={getErrorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : query.isPending ? (
        <p>Đang tải lịch…</p>
      ) : data ? (
        tab === 'schedule' ? (
          <ScheduleGrid
            data={data}
            from={from}
            admin={admin}
            busy={busy}
            onOpen={open}
            onClock={clock}
          />
        ) : tab === 'coverage' ? (
          <CoveragePanel data={data} busy={busy} onOpen={open} />
        ) : tab === 'cash' ? (
          <WorkforceCashPanel data={data.cash} />
        ) : (
          <MetricsTable data={data} admin={admin} />
        )
      ) : null}
      <EditorModal
        editor={editor}
        data={data}
        from={from}
        busy={busy}
        pending={save.isPending}
        error={error}
        uncertain={uncertain}
        onClose={() => setEditor(null)}
        onSubmit={submit}
        onRetry={send}
      />
      {copyRequestId ? (
        <WorkforceCopyModal
          from={from}
          requestId={copyRequestId}
          onClose={() => setCopyRequestId(null)}
          onSuccess={(count, targetFrom) => {
            setCopyRequestId(null);
            setFrom(targetFrom);
            setMessage(`Đã sao chép ${count} ca.`);
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}
