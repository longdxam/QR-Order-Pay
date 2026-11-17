import type { Types } from 'mongoose';
import type { WorkforceWeek } from '@may-cafe/contracts';
import {
  workActivityRepository,
  workShiftRepository,
} from '../repositories/workforceRepository.js';
import { minutes, toWorkShift } from './workforceShiftDto.js';

type Stage = 'confirmed' | 'preparing' | 'ready' | 'served';
const averageMinutes = (ms: number) => Math.round(ms / 6000) / 10;
const averageRating = (avg: number) => Math.round(avg * 100) / 100;

/** Số công đoạn KDS, thời gian pha và sao đánh giá gắn với từng ca. */
export async function metricsByShift(
  ids: Types.ObjectId[],
): Promise<WorkforceWeek['shiftMetrics']> {
  const result = await workActivityRepository.facetsByShift(ids);
  return ids.map((id) => {
    const row: WorkforceWeek['shiftMetrics'][number] = {
      workShiftId: String(id),
      confirmed: 0,
      preparing: 0,
      ready: 0,
      served: 0,
      preparationSamples: 0,
      averagePreparationMinutes: null,
      reviewedOrders: 0,
      averageOrderRating: null,
    };
    for (const c of result?.counts ?? [])
      if (String(c._id.shift) === String(id)) row[c._id.stage.toLowerCase() as Stage] = c.count;
    const p = result?.preparation.find((r) => String(r._id) === String(id));
    if (p) {
      row.preparationSamples = p.count;
      row.averagePreparationMinutes = averageMinutes(p.avg);
    }
    const r = result?.reviews.find((r) => String(r._id) === String(id));
    if (r) {
      row.reviewedOrders = r.count;
      row.averageOrderRating = averageRating(r.avg);
    }
    return row;
  });
}

/**
 * Bảng công theo nhân viên trong tuần. Giờ làm được cắt theo tuần; mẫu thời gian pha thuộc mốc READY.
 * `staffId` = null: toàn bộ nhân viên (Admin).
 */
export async function workforceMetrics(
  start: Date,
  end: Date,
  staffId: string | null,
  now: Date,
): Promise<WorkforceWeek['metrics']> {
  const attendance = await workShiftRepository.listAttendance(start, end, staffId);
  const counts = await workActivityRepository.stageCountsByStaff(start, end, staffId);
  const preparation = await workActivityRepository.preparationByStaff(start, end, staffId);
  const reviews = await workActivityRepository.reviewsByStaff(start, end, staffId);
  const rows = new Map<string, WorkforceWeek['metrics'][number]>();
  function row(id: string, name: string) {
    if (!rows.has(id))
      rows.set(id, {
        staffId: id,
        staffName: name,
        scheduledMinutes: 0,
        workedMinutes: 0,
        openAttendances: 0,
        absentShifts: 0,
        lateShifts: 0,
        confirmed: 0,
        preparing: 0,
        ready: 0,
        served: 0,
        outsideShiftActions: 0,
        preparationSamples: 0,
        averagePreparationMinutes: null,
        reviewedOrders: 0,
        averageOrderRating: null,
      });
    return rows.get(id)!;
  }
  for (const s of attendance) {
    const r = row(String(s.staffId), s.staffName);
    const scheduledHere = s.startsAt < end && s.endsAt > start;
    if (scheduledHere) {
      r.scheduledMinutes += minutes(
        new Date(Math.max(start.getTime(), s.startsAt.getTime())),
        new Date(Math.min(end.getTime(), s.endsAt.getTime())),
      );
      if (!s.effectiveInAt && s.endsAt <= now) r.absentShifts++;
      if (toWorkShift(s, now).lateMinutes > 0) r.lateShifts++;
    }
    if (s.effectiveInAt) {
      if (!s.effectiveOutAt) r.openAttendances++;
      else
        r.workedMinutes += minutes(
          new Date(Math.max(start.getTime(), s.effectiveInAt.getTime())),
          new Date(Math.min(end.getTime(), s.effectiveOutAt.getTime())),
        );
    }
  }
  for (const c of counts) {
    const r = row(String(c._id.staffId), c.name);
    r[c._id.stage.toLowerCase() as Stage] = c.count;
    r.outsideShiftActions += c.outside;
  }
  for (const p of preparation) {
    const r = row(String(p._id), p.name);
    r.preparationSamples = p.count;
    r.averagePreparationMinutes = averageMinutes(p.avg);
  }
  for (const v of reviews) {
    const r = row(String(v._id), v.name);
    r.reviewedOrders = v.count;
    r.averageOrderRating = averageRating(v.avg);
  }
  return [...rows.values()].sort((a, b) => a.staffName.localeCompare(b.staffName, 'vi'));
}
