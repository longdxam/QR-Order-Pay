import { workWeekQuerySchema, type WorkforceWeek } from '@may-cafe/contracts';
import type { WorkShiftDoc } from '../models/WorkShift.js';
import { userRepository } from '../repositories/userRepository.js';
import {
  staffingPolicyRepository,
  workShiftRepository,
} from '../repositories/workforceRepository.js';
import { workforceClock } from '../utils/workforceClock.js';
import { workforcePeaks, workforceCash } from './workforceReportsService.js';
import { metricsByShift, workforceMetrics } from './workforceMetricsService.js';
import { HOUR, toWorkShift } from './workforceShiftDto.js';

type Rule = WorkforceWeek['policy']['rules'][number];
type Roster = Awaited<ReturnType<typeof userRepository.listRoster>>;

/**
 * Độ phủ nhân sự theo từng khung yêu cầu trong tuần: `scheduled` là số người ít nhất có lịch tại
 * mọi thời điểm của khung (chỉ tính tài khoản còn hoạt động); `presentNow` chỉ có khi khung đang diễn ra.
 */
async function coverage(
  start: Date,
  now: Date,
  rules: Rule[],
  shifts: WorkShiftDoc[],
  users: Roster,
): Promise<WorkforceWeek['coverage']> {
  const result: WorkforceWeek['coverage'] = [];
  for (let d = 0; d < 7; d++) {
    const dayStart = new Date(start.getTime() + d * 24 * HOUR);
    const weekday = new Date(dayStart.getTime() + 7 * HOUR).getUTCDay() || 7;
    for (const rule of rules.filter((r) => r.day === weekday)) {
      const a = dayStart.getTime() + rule.startMinute * 60000,
        b = dayStart.getTime() + rule.endMinute * 60000;
      const active = shifts.filter(
        (s) =>
          s.status !== 'CANCELLED' &&
          s.startsAt.getTime() < b &&
          s.endsAt.getTime() > a &&
          users.some((u) => String(u._id) === String(s.staffId) && u.isActive),
      );
      const boundaries = [
        ...new Set([
          a,
          ...active
            .flatMap((s) => [s.startsAt.getTime(), s.endsAt.getTime()])
            .filter((t) => t > a && t < b),
        ]),
      ];
      const scheduled = Math.min(
        ...boundaries.map(
          (t) =>
            new Set(
              active
                .filter((s) => s.startsAt.getTime() <= t && s.endsAt.getTime() > t)
                .map((s) => String(s.staffId)),
            ).size,
        ),
      );
      const presentNow =
        now.getTime() >= a && now.getTime() < b
          ? await workShiftRepository.countWorking(
              users.filter((u) => u.isActive).map((u) => u._id),
              now,
            )
          : null;
      result.push({
        label: rule.label,
        startsAt: new Date(a).toISOString(),
        endsAt: new Date(b).toISOString(),
        required: rule.minStaff,
        scheduled,
        shortage: Math.max(0, rule.minStaff - scheduled),
        presentNow,
      });
    }
  }
  return result;
}

/** Lịch tuần: nhân viên chỉ thấy ca của mình; Admin thấy cả nhân sự, cấu hình, độ phủ, cao điểm và két. */
export async function workforceWeek(
  actorId: string,
  admin: boolean,
  raw: unknown,
): Promise<WorkforceWeek> {
  const { from } = workWeekQuerySchema.parse(raw);
  const start = new Date(`${from}T00:00:00+07:00`),
    end = new Date(start.getTime() + 7 * 24 * HOUR),
    now = workforceClock.now();
  const shifts = await workShiftRepository.listOverlapping(start, end, admin ? null : actorId);
  const current = await workShiftRepository.findWorking(actorId);
  const users = admin ? await userRepository.listRoster() : [];
  const policy = admin ? await staffingPolicyRepository.readDefault() : null;
  const rules: Rule[] = (policy?.rules ?? []).map((r) => ({
    day: r.day!,
    startMinute: r.startMinute!,
    endMinute: r.endMinute!,
    minStaff: r.minStaff!,
    label: r.label!,
  }));
  const weekCoverage = admin ? await coverage(start, now, rules, shifts, users) : [];
  const metrics = await workforceMetrics(start, end, admin ? null : actorId, now);
  const shiftMetrics = await metricsByShift(shifts.map((s) => s._id));
  const [peaks, cash] = admin
    ? await Promise.all([
        workforcePeaks(start, now, policy?.ordersPerStaffHour ?? 6),
        workforceCash(start, end),
      ])
    : [null, null];
  return {
    from,
    until: end.toISOString(),
    now: now.toISOString(),
    shifts: shifts.map((s) => toWorkShift(s, now)),
    currentShift: current ? toWorkShift(current, now) : null,
    staff: users.map((u) => ({ id: String(u._id), name: u.name, isActive: u.isActive })),
    policy: {
      version: policy?.version ?? 0,
      rules,
      ordersPerStaffHour: policy?.ordersPerStaffHour ?? 6,
    },
    peaks,
    cash,
    coverage: weekCoverage,
    metrics,
    shiftMetrics,
  };
}
