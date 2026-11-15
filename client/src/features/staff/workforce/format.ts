import {
  staffingPolicySchema,
  workAttendanceCorrectionSchema,
  workShiftCreateSchema,
  workShiftUpdateSchema,
  type WorkShiftDto,
  type WorkforceWeek,
} from '@may-cafe/contracts';

// Mọi ngày giờ nhân sự hiển thị và nhập theo giờ Việt Nam (UTC+7), không theo múi giờ máy.
export const DAY = 86400000;
const VN_OFFSET = 7 * 3600000;

export { generateRequestId as newRequestId } from '../../../lib/api';

/** `YYYY-MM-DD` theo giờ Việt Nam. */
export const vnDate = (date: Date): string =>
  new Date(date.getTime() + VN_OFFSET).toISOString().slice(0, 10);
/** Giá trị cho `<input type="datetime-local">` theo giờ Việt Nam. */
export const localInput = (iso: string): string =>
  new Date(Date.parse(iso) + VN_OFFSET).toISOString().slice(0, 16);
/** Đọc `datetime-local` (giờ Việt Nam) thành ISO UTC. */
export const asIso = (value: FormDataEntryValue | null): string =>
  new Date(`${String(value)}:00+07:00`).toISOString();
export const stamp = (iso: string): string =>
  new Date(iso).toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
export const time = (iso: string): string =>
  new Date(iso).toLocaleTimeString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
  });
/** Thứ Hai của tuần hiện tại theo giờ Việt Nam. */
export function monday(): string {
  const date = new Date(`${vnDate(new Date())}T00:00:00+07:00`);
  const weekday = new Date(date.getTime() + VN_OFFSET).getUTCDay() || 7;
  return vnDate(new Date(date.getTime() - (weekday - 1) * DAY));
}
export const shiftWeek = (from: string, weeks: number): string =>
  vnDate(new Date(Date.parse(`${from}T00:00:00+07:00`) + weeks * 7 * DAY));
export const weekDay = (from: string, offset: number): string =>
  vnDate(new Date(Date.parse(`${from}T00:00:00+07:00`) + offset * DAY));

export const minuteValue = (value: FormDataEntryValue | null): number => {
  const [h, m] = String(value).split(':').map(Number);
  return h! * 60 + m!;
};
export const minuteInput = (n: number): string =>
  `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

export const attendanceLabels = {
  CANCELLED: 'Đã hủy',
  UPCOMING: 'Sắp tới',
  WAITING: 'Chưa vào ca',
  ABSENT: 'Vắng',
  WORKING: 'Đang làm',
  COMPLETED: 'Đã ra ca',
};

export type Editor =
  | { kind: 'schedule'; shift: WorkShiftDto | null; requestId: string }
  | { kind: 'cancel'; shift: WorkShiftDto }
  | { kind: 'attendance'; shift: WorkShiftDto }
  | { kind: 'policy'; version: number; rules: WorkforceWeek['policy']['rules']; capacity: number };
/** Một lần ghi giữ nguyên để thử lại an toàn khi chưa rõ kết quả (mạng/5xx). */
export type Write = { method: 'post' | 'patch' | 'put'; url: string; body: unknown };

/**
 * Dựng request từ form của hộp sửa. Ném `ZodError` khi dữ liệu không hợp lệ, hoặc lỗi khác khi
 * ngày giờ không đọc được. `ruleCount` là số khung nhu cầu đang hiển thị trong form chính sách.
 */
export function editorWrite(editor: Editor, form: FormData, ruleCount: number): Write {
  if (editor.kind === 'schedule') {
    const fields = {
      staffId: form.get('staffId'),
      label: form.get('label'),
      note: form.get('note'),
      startsAt: asIso(form.get('startsAt')),
      endsAt: asIso(form.get('endsAt')),
    };
    const body = editor.shift
      ? workShiftUpdateSchema.parse({ ...fields, expectedVersion: editor.shift.version })
      : workShiftCreateSchema.parse({ ...fields, requestId: editor.requestId });
    return {
      method: editor.shift ? 'patch' : 'post',
      url: `/admin/workforce/shifts${editor.shift ? `/${editor.shift.id}` : ''}`,
      body,
    };
  }
  if (editor.kind === 'cancel')
    return {
      method: 'post',
      url: `/admin/workforce/shifts/${editor.shift.id}/cancel`,
      body: { expectedVersion: editor.shift.version, reason: String(form.get('reason')).trim() },
    };
  if (editor.kind === 'attendance')
    return {
      method: 'post',
      url: `/admin/workforce/shifts/${editor.shift.id}/attendance`,
      body: workAttendanceCorrectionSchema.parse({
        expectedVersion: editor.shift.version,
        startsAt: asIso(form.get('startsAt')),
        endsAt: asIso(form.get('endsAt')),
        reason: form.get('reason'),
      }),
    };
  const rules = Array.from({ length: ruleCount }, (_, index) => ({
    day: Number(form.get(`day-${index}`)),
    label: form.get(`label-${index}`),
    startMinute: minuteValue(form.get(`start-${index}`)),
    endMinute: minuteValue(form.get(`end-${index}`)),
    minStaff: Number(form.get(`min-${index}`)),
  }));
  return {
    method: 'put',
    url: '/admin/workforce/policy',
    body: staffingPolicySchema.parse({
      expectedVersion: editor.version,
      rules,
      ordersPerStaffHour: Number(form.get('ordersPerStaffHour')),
    }),
  };
}
