import type { WorkShiftDto, WorkforceWeek } from '@may-cafe/contracts';
import { Button } from '../../../components/ui/Button';
import { attendanceLabels, newRequestId, stamp, vnDate, weekDay, type Editor } from './format';

interface ScheduleProps {
  data: WorkforceWeek;
  from: string;
  admin: boolean;
  busy: boolean;
  onOpen: (editor: Editor) => void;
  onClock: (shift: WorkShiftDto, direction: 'in' | 'out') => void;
}

/** Bảy ngày của tuần, mỗi ngày liệt kê các ca chạm vào ngày đó (kể cả ca qua đêm). */
export function ScheduleGrid({ data, from, ...actions }: ScheduleProps): JSX.Element {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {Array.from({ length: 7 }, (_, d) => {
        const day = weekDay(from, d);
        const shifts = data.shifts.filter(
          (s) =>
            vnDate(new Date(s.startsAt)) <= day &&
            vnDate(new Date(Date.parse(s.endsAt) - 1)) >= day,
        );
        return (
          <section key={day} className="min-w-0 rounded-2xl border bg-card p-4">
            <h2 className="mb-3 font-semibold">
              {new Date(`${day}T00:00:00+07:00`).toLocaleDateString('vi-VN', {
                timeZone: 'Asia/Ho_Chi_Minh',
                weekday: 'long',
                day: '2-digit',
                month: '2-digit',
              })}
            </h2>
            {!shifts.length ? (
              <p className="text-sm text-muted-foreground">Chưa có lịch ca.</p>
            ) : (
              <div className="space-y-3">
                {shifts.map((s) => (
                  <ShiftCard key={s.id} shift={s} data={data} {...actions} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function ShiftCard({
  shift: s,
  data,
  admin,
  busy,
  onOpen,
  onClock,
}: Omit<ScheduleProps, 'from'> & { shift: WorkShiftDto }): JSX.Element {
  const current = data.currentShift;
  return (
    <article className="space-y-2 rounded-xl border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">
          {s.staffName} · {s.label}
        </h3>
        <span
          className={`rounded-full px-2 py-1 text-xs ${s.attendance === 'ABSENT' ? 'bg-danger/10 text-danger' : s.attendance === 'WORKING' ? 'bg-primary/10 text-primary' : 'bg-muted'}`}
        >
          {attendanceLabels[s.attendance]}
        </span>
      </div>
      <p className="text-sm">
        {stamp(s.startsAt)} – {stamp(s.endsAt)}
      </p>
      {s.note ? <p className="break-words text-sm text-muted-foreground">{s.note}</p> : null}
      {s.effectiveInAt ? (
        <p className="text-sm">
          Thực tế {stamp(s.effectiveInAt)} →{' '}
          {s.effectiveOutAt ? stamp(s.effectiveOutAt) : 'chưa ra ca'}
          {s.workedMinutes !== null ? ` · ${s.workedMinutes} phút` : ''}
          {s.lateMinutes ? ` · Trễ ${s.lateMinutes} phút sau dung sai` : ''}
        </p>
      ) : null}
      {s.correctionReason ? (
        <p className="break-words text-sm text-muted-foreground">
          Điều chỉnh bởi {s.correctedByName}: {s.correctionReason}. Chấm gốc:{' '}
          {s.clockInAt ? stamp(s.clockInAt) : 'chưa vào'} →{' '}
          {s.clockOutAt ? stamp(s.clockOutAt) : 'chưa ra'}.
        </p>
      ) : null}
      {s.cancelReason ? (
        <p className="break-words text-sm text-muted-foreground">Lý do hủy: {s.cancelReason}</p>
      ) : null}
      {data.shiftMetrics
        .filter((m) => m.workShiftId === s.id)
        .map((m) => (
          <p key={m.workShiftId} className="text-xs text-muted-foreground">
            KDS gắn ca: nhận {m.confirmed} · pha {m.preparing} · sẵn sàng {m.ready} · giao{' '}
            {m.served}
            {m.averagePreparationMinutes !== null
              ? ` · pha TB ${m.averagePreparationMinutes} phút (${m.preparationSamples} mẫu)`
              : ''}
            {m.averageOrderRating !== null
              ? ` · sao đơn đã giao ${m.averageOrderRating}/5 (${m.reviewedOrders} đơn)`
              : ''}
          </p>
        ))}
      <div className="flex flex-wrap gap-2">
        {admin && s.status === 'SCHEDULED' ? (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onOpen({ kind: 'schedule', shift: s, requestId: newRequestId() })}
            >
              Sửa lịch
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => onOpen({ kind: 'cancel', shift: s })}
            >
              Hủy ca
            </Button>
          </>
        ) : null}
        {admin && s.status !== 'CANCELLED' && Date.parse(s.startsAt) < Date.parse(data.now) ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onOpen({ kind: 'attendance', shift: s })}
          >
            Điều chỉnh giờ
          </Button>
        ) : null}
        {!admin && s.status === 'SCHEDULED' ? (
          <Button
            size="sm"
            disabled={
              busy ||
              !!current ||
              // Được vào ca từ 30 phút trước giờ bắt đầu đến trước giờ kết thúc.
              Date.parse(data.now) < Date.parse(s.startsAt) - 1800000 ||
              Date.parse(data.now) >= Date.parse(s.endsAt)
            }
            onClick={() => onClock(s, 'in')}
          >
            Vào ca
          </Button>
        ) : null}
      </div>
    </article>
  );
}
