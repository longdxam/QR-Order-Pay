import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import type { WorkShiftDto } from '@may-cafe/contracts';
import { editorWrite, monday, shiftWeek, vnDate } from '../features/staff/workforce/format';

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const shift = { id: 'shift-1', version: 4 } as WorkShiftDto;
const staffId = '507f1f77bcf86cd799439011';
const requestId = 'b8195819-0467-4531-a23c-819a80f7214a';

describe('workforce editorWrite', () => {
  it('creates a new shift with the idempotent requestId, reading inputs as Vietnam time', () => {
    const write = editorWrite(
      { kind: 'schedule', shift: null, requestId },
      form({
        staffId,
        label: ' Ca sáng ',
        note: '',
        startsAt: '2026-11-16T07:00',
        endsAt: '2026-11-16T12:00',
      }),
      0,
    );
    expect(write).toEqual({
      method: 'post',
      url: '/admin/workforce/shifts',
      body: {
        staffId,
        label: 'Ca sáng',
        note: '',
        startsAt: '2026-11-16T00:00:00.000Z',
        endsAt: '2026-11-16T05:00:00.000Z',
        requestId,
      },
    });
  });

  it('patches an existing shift with optimistic locking instead of a requestId', () => {
    const write = editorWrite(
      { kind: 'schedule', shift, requestId },
      form({
        staffId,
        label: 'Ca chiều',
        note: 'Đổi ca',
        startsAt: '2026-11-16T13:00',
        endsAt: '2026-11-16T18:00',
      }),
      0,
    );
    expect(write.method).toBe('patch');
    expect(write.url).toBe('/admin/workforce/shifts/shift-1');
    expect(write.body).toMatchObject({ expectedVersion: 4 });
    expect(write.body).not.toHaveProperty('requestId');
  });

  it('rejects a shift longer than 16 hours before any request is sent', () => {
    expect(() =>
      editorWrite(
        { kind: 'schedule', shift: null, requestId },
        form({
          staffId,
          label: 'Ca dài',
          note: '',
          startsAt: '2026-11-16T06:00',
          endsAt: '2026-11-16T23:00',
        }),
        0,
      ),
    ).toThrow(ZodError);
  });

  it('cancels with a trimmed reason and builds staffing rules by index', () => {
    expect(editorWrite({ kind: 'cancel', shift }, form({ reason: '  Nghỉ ốm  ' }), 0)).toEqual({
      method: 'post',
      url: '/admin/workforce/shifts/shift-1/cancel',
      body: { expectedVersion: 4, reason: 'Nghỉ ốm' },
    });
    const policy = editorWrite(
      { kind: 'policy', version: 2, rules: [], capacity: 6 },
      form({
        ordersPerStaffHour: '8',
        'day-0': '1',
        'label-0': 'Cao điểm sáng',
        'start-0': '07:00',
        'end-0': '09:30',
        'min-0': '3',
        'day-1': '7',
        'label-1': 'Cuối ngày',
        'start-1': '21:00',
        'end-1': '24:00',
        'min-1': '1',
      }),
      2,
    );
    expect(policy).toEqual({
      method: 'put',
      url: '/admin/workforce/policy',
      body: {
        expectedVersion: 2,
        ordersPerStaffHour: 8,
        rules: [
          { day: 1, label: 'Cao điểm sáng', startMinute: 420, endMinute: 570, minStaff: 3 },
          { day: 7, label: 'Cuối ngày', startMinute: 1260, endMinute: 1440, minStaff: 1 },
        ],
      },
    });
  });

  it('moves between weeks on Vietnam calendar days', () => {
    const start = monday();
    expect(new Date(`${start}T00:00:00+07:00`).getUTCDay()).toBe(0); // 00:00 VN thứ Hai = Chủ nhật UTC
    expect(shiftWeek(start, 1)).toBe(
      vnDate(new Date(Date.parse(`${start}T00:00:00+07:00`) + 7 * 86400000)),
    );
    expect(shiftWeek(shiftWeek(start, -1), 1)).toBe(start);
  });
});
