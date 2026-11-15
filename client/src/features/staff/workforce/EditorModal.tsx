import { useState, type FormEvent } from 'react';
import type { WorkforceWeek } from '@may-cafe/contracts';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import { localInput, minuteInput, newRequestId, type Editor, type Write } from './format';

const TITLES: Record<Editor['kind'], string> = {
  schedule: 'Xếp ca',
  cancel: 'Hủy lịch ca',
  attendance: 'Điều chỉnh chấm công',
  policy: 'Nhu cầu nhân sự',
};

/** Hộp xếp/sửa/hủy ca, điều chỉnh chấm công và cấu hình nhu cầu nhân sự (Admin). */
export function EditorModal({
  editor,
  data,
  from,
  busy,
  pending,
  error,
  uncertain,
  onClose,
  onSubmit,
  onRetry,
}: {
  editor: Editor | null;
  data: WorkforceWeek | undefined;
  from: string;
  busy: boolean;
  pending: boolean;
  error: string;
  uncertain: Write | null;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onRetry: (write: Write) => void;
}): JSX.Element {
  return (
    <Modal
      open={!!editor}
      onOpenChange={(v) => {
        if (!v && !busy) onClose();
      }}
      title={
        editor?.kind === 'schedule' && editor.shift
          ? 'Sửa lịch ca'
          : TITLES[editor?.kind ?? 'policy']
      }
    >
      {editor && data ? (
        <form
          key={
            editor.kind === 'policy'
              ? `policy-${editor.version}`
              : editor.kind === 'schedule'
                ? (editor.shift?.id ?? editor.requestId)
                : editor.shift.id
          }
          onSubmit={onSubmit}
          className="space-y-4"
        >
          <fieldset disabled={busy} className="space-y-4">
            {editor.kind === 'schedule' ? (
              <>
                <label className="block text-sm">
                  Nhân viên
                  <select
                    name="staffId"
                    defaultValue={editor.shift?.staffId}
                    required
                    className="mt-1 w-full rounded-xl border bg-background p-3"
                  >
                    {data.staff
                      .filter((s) => s.isActive)
                      .map((s) => (
                        <option value={s.id} key={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="block text-sm">
                  Tên ca
                  <Input
                    name="label"
                    defaultValue={editor.shift?.label ?? 'Ca sáng'}
                    maxLength={80}
                    required
                  />
                </label>
                <TimeFields
                  start={editor.shift?.startsAt ?? `${from}T07:00:00+07:00`}
                  end={editor.shift?.endsAt ?? `${from}T12:00:00+07:00`}
                />
                <label className="block text-sm">
                  Ghi chú
                  <Input name="note" defaultValue={editor.shift?.note ?? ''} maxLength={500} />
                </label>
                <p className="text-xs text-muted-foreground">
                  Mỗi ca tối đa 16 giờ, có thể qua đêm. Không trùng lịch của cùng nhân viên. Ca đã
                  vào làm không thể sửa lịch.
                </p>
              </>
            ) : editor.kind === 'attendance' ? (
              <>
                <p className="text-sm">
                  {editor.shift.staffName} · {editor.shift.label}. Giữ nguyên giờ bấm gốc và lưu
                  lịch sử điều chỉnh. Hai giờ thực tế phải ở quá khứ, tối đa 24 giờ.
                </p>
                <TimeFields
                  start={editor.shift.effectiveInAt ?? editor.shift.startsAt}
                  end={editor.shift.effectiveOutAt ?? editor.shift.endsAt}
                />
                <label className="block text-sm">
                  Lý do điều chỉnh
                  <Input name="reason" minLength={3} maxLength={500} required />
                </label>
              </>
            ) : editor.kind === 'cancel' ? (
              <>
                <p>
                  Hủy ca {editor.shift.label} của {editor.shift.staffName}?
                </p>
                <label className="block text-sm">
                  Lý do hủy
                  <Input name="reason" minLength={3} maxLength={500} required />
                </label>
              </>
            ) : (
              <PolicyFields rules={editor.rules} capacity={editor.capacity} />
            )}
            <Button type="submit" disabled={busy}>
              {pending ? 'Đang ghi…' : 'Lưu'}
            </Button>
          </fieldset>
          {error ? (
            <p role="alert" className="text-danger">
              {error}
            </p>
          ) : null}
          {uncertain ? <Retry write={uncertain} pending={pending} onRetry={onRetry} /> : null}
          {!busy && error ? (
            <p className="text-xs text-muted-foreground">
              Nếu ca đã đổi, đóng hộp này và tải lại trước khi sửa tiếp.
            </p>
          ) : null}
        </form>
      ) : null}
    </Modal>
  );
}

function TimeFields({ start, end }: { start: string; end: string }): JSX.Element {
  return (
    <>
      <label className="block text-sm">
        Bắt đầu (giờ Việt Nam)
        <Input name="startsAt" type="datetime-local" defaultValue={localInput(start)} required />
      </label>
      <label className="block text-sm">
        Kết thúc (giờ Việt Nam)
        <Input name="endsAt" type="datetime-local" defaultValue={localInput(end)} required />
      </label>
    </>
  );
}

/** Mỗi khung có `data-rule`; `editorWrite` đọc lại theo chỉ số `day-0`, `label-0`… */
function PolicyFields({
  rules,
  capacity,
}: {
  rules: WorkforceWeek['policy']['rules'];
  capacity: number;
}): JSX.Element {
  const [rows, setRows] = useState(rules.map((r, i) => ({ ...r, key: `saved-${i}` })));
  return (
    <div className="space-y-3">
      <label className="block text-sm">
        Định mức đơn/người/giờ
        <Input
          name="ordersPerStaffHour"
          type="number"
          min={1}
          max={100}
          step={1}
          defaultValue={capacity ?? 6}
          required
        />
      </label>
      <p className="text-sm text-muted-foreground">
        Thứ 2–Chủ nhật, số người tối thiểu cho toàn khung. Các khung trong cùng ngày không chồng
        lấn. Chọn 24:00 cho cuối ngày.
      </p>
      {rows.map((r, i) => (
        <div data-rule key={r.key} className="space-y-2 rounded-xl border p-3">
          <label className="block text-sm">
            Tên khung
            <Input name={`label-${i}`} defaultValue={r.label} maxLength={80} required />
          </label>
          <label className="block text-sm">
            Ngày
            <select
              name={`day-${i}`}
              defaultValue={r.day}
              className="w-full rounded-xl border bg-background p-2"
            >
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <option value={d} key={d}>
                  {d === 7 ? 'Chủ nhật' : `Thứ ${d + 1}`}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm">
              Từ
              <Input
                name={`start-${i}`}
                type="time"
                defaultValue={minuteInput(r.startMinute)}
                required
              />
            </label>
            <label className="text-sm">
              Đến
              <select
                name={`end-${i}`}
                defaultValue={minuteInput(r.endMinute)}
                className="w-full rounded-xl border bg-background p-3"
              >
                {[...new Set([...Array.from({ length: 96 }, (_, n) => (n + 1) * 15), r.endMinute])]
                  .sort((a, b) => a - b)
                  .map((n) => (
                    <option value={minuteInput(n)} key={n}>
                      {minuteInput(n)}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <label className="block text-sm">
            Số người tối thiểu
            <Input
              name={`min-${i}`}
              type="number"
              min={1}
              max={50}
              step={1}
              defaultValue={r.minStaff}
              required
            />
          </label>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setRows(rows.filter((row) => row.key !== r.key))}
          >
            Bỏ khung
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        disabled={rows.length >= 100}
        onClick={() =>
          setRows([
            ...rows,
            {
              day: 1,
              startMinute: 420,
              endMinute: 540,
              minStaff: 2,
              label: 'Cao điểm sáng',
              key: newRequestId(),
            },
          ])
        }
      >
        Thêm khung giờ
      </Button>
      {!rows.length ? (
        <p className="text-sm">Lưu danh sách rỗng sẽ tắt cảnh báo thiếu người.</p>
      ) : null}
    </div>
  );
}

export function Retry({
  write,
  pending,
  onRetry,
}: {
  write: Write;
  pending: boolean;
  onRetry: (write: Write) => void;
}): JSX.Element {
  return (
    <div className="space-y-2 rounded-xl border p-3">
      <p className="text-sm">Chưa rõ kết quả ghi nhận. Giữ nguyên yêu cầu để thử lại an toàn.</p>
      <Button type="button" disabled={pending} onClick={() => onRetry(write)}>
        Thử lại yêu cầu
      </Button>
    </div>
  );
}
