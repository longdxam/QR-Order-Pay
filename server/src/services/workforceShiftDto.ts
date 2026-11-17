import type { WorkShiftDto } from '@may-cafe/contracts';
import type { WorkShiftDoc } from '../models/WorkShift.js';
import { workforceClock } from '../utils/workforceClock.js';

export const HOUR = 3600000;
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
export const minutes = (a: Date, b: Date) =>
  Math.max(0, Math.floor((b.getTime() - a.getTime()) / 60000));

/** Ca làm cho API; trễ được tính sau dung sai 5 phút, trạng thái chấm công suy ra theo `now`. */
export function toWorkShift(shift: WorkShiftDoc, now = workforceClock.now()): WorkShiftDto {
  const effectiveIn = shift.effectiveInAt ?? null;
  const effectiveOut = shift.effectiveOutAt ?? null;
  return {
    id: shift.id,
    staffId: String(shift.staffId),
    staffName: shift.staffName,
    label: shift.label,
    startsAt: shift.startsAt.toISOString(),
    endsAt: shift.endsAt.toISOString(),
    status: shift.status as WorkShiftDto['status'],
    note: shift.note,
    clockInAt: iso(shift.clockInAt),
    clockOutAt: iso(shift.clockOutAt),
    effectiveInAt: iso(effectiveIn),
    effectiveOutAt: iso(effectiveOut),
    correctionReason: shift.correctionReason,
    correctedByName: shift.correctedByName,
    cancelReason: shift.cancelReason,
    version: shift.version,
    lateMinutes: effectiveIn ? Math.max(0, minutes(shift.startsAt, effectiveIn) - 5) : 0,
    workedMinutes: effectiveIn && effectiveOut ? minutes(effectiveIn, effectiveOut) : null,
    attendance:
      shift.status === 'CANCELLED'
        ? 'CANCELLED'
        : effectiveOut
          ? 'COMPLETED'
          : effectiveIn
            ? 'WORKING'
            : now >= shift.endsAt
              ? 'ABSENT'
              : now >= shift.startsAt
                ? 'WAITING'
                : 'UPCOMING',
  };
}
