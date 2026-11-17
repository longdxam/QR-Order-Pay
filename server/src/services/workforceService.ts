import type { ClientSession } from 'mongoose';
import {
  workShiftCreateSchema,
  workShiftUpdateSchema,
  workShiftCancelSchema,
  workClockSchema,
  workAttendanceCorrectionSchema,
  staffingPolicySchema,
} from '@may-cafe/contracts';
import { unitOfWork } from '../infrastructure/unitOfWork.js';
import { auditRepository } from '../repositories/auditRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import {
  staffingPolicyRepository,
  workActivityRepository,
  workShiftRepository,
} from '../repositories/workforceRepository.js';
import { ConflictError, ForbiddenError, ValidationError } from '../errors/AppError.js';
import { sha256 } from '../utils/crypto.js';
import { workforceClock } from '../utils/workforceClock.js';
import { queueWorkforceChanged } from './workforceRealtimeService.js';
import { HOUR, toWorkShift } from './workforceShiftDto.js';
import {
  assertAttendanceFree,
  assertWorkScheduleFree,
  checkVersion,
  lockWorkforceUser,
  logWorkShiftAudit,
  shiftById,
} from './workforceGuards.js';

// Các module khác (controller, sao chép lịch, test) import qua đây.
export { toWorkShift } from './workforceShiftDto.js';
export { workforceWeek } from './workforceWeekService.js';
export { lockWorkforceUser, assertWorkScheduleFree, logWorkShiftAudit } from './workforceGuards.js';

export async function createWorkShift(actorId: string, raw: unknown) {
  const data = workShiftCreateSchema.parse(raw);
  const requestHash = sha256(JSON.stringify(data));
  return unitOfWork
    .withTransaction(async (session) => {
      await lockWorkforceUser(actorId, session, true);
      const user = await lockWorkforceUser(data.staffId, session);
      const existing = await workShiftRepository.findByRequestId(data.requestId, session);
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw new ConflictError('IDEMPOTENCY_CONFLICT', 'Mã yêu cầu đã dùng với dữ liệu khác.');
        return toWorkShift(existing);
      }
      const start = new Date(data.startsAt),
        end = new Date(data.endsAt);
      if (end <= workforceClock.now())
        throw new ValidationError(
          'Không tạo lịch ca đã kết thúc. Dùng điều chỉnh chấm công cho ca đã có.',
        );
      await assertWorkScheduleFree(data.staffId, start, end, null, session);
      const shift = await workShiftRepository.create(
        { ...data, staffName: user.name, requestHash },
        session,
      );
      await logWorkShiftAudit(actorId, 'scheduled', shift, null, session);
      return toWorkShift(shift);
    })
    .catch(async (error: unknown) => {
      if ((error as { code?: number }).code === 11000) {
        const existing = await workShiftRepository.findByRequestId(data.requestId);
        if (existing?.requestHash === requestHash) return toWorkShift(existing);
        throw new ConflictError(
          'IDEMPOTENCY_CONFLICT',
          'Mã yêu cầu vừa được dùng với dữ liệu khác.',
        );
      }
      throw error;
    });
}
export async function updateWorkShift(id: string, actorId: string, raw: unknown) {
  const data = workShiftUpdateSchema.parse(raw);
  return unitOfWork.withTransaction(async (session) => {
    await lockWorkforceUser(actorId, session, true);
    const shift = await shiftById(id, session);
    await lockWorkforceUser(String(shift.staffId), session);
    const user = await lockWorkforceUser(data.staffId, session);
    if (
      shift.version === data.expectedVersion + 1 &&
      String(shift.staffId) === data.staffId &&
      shift.label === data.label &&
      shift.note === data.note &&
      shift.startsAt.getTime() === Date.parse(data.startsAt) &&
      shift.endsAt.getTime() === Date.parse(data.endsAt) &&
      shift.status === 'SCHEDULED'
    )
      return toWorkShift(shift);
    checkVersion(shift, data.expectedVersion);
    if (shift.status !== 'SCHEDULED')
      throw new ConflictError('WORK_SHIFT_LOCKED', 'Ca đã vào làm hoặc đã hủy không thể đổi lịch.');
    const start = new Date(data.startsAt),
      end = new Date(data.endsAt);
    if (end <= workforceClock.now()) throw new ValidationError('Lịch mới phải chưa kết thúc.');
    await assertWorkScheduleFree(data.staffId, start, end, id, session);
    const before = toWorkShift(shift);
    shift.set({ ...data, staffName: user.name, version: shift.version + 1 });
    await workShiftRepository.save(shift, session);
    await logWorkShiftAudit(actorId, 'rescheduled', shift, before, session);
    return toWorkShift(shift);
  });
}
export async function cancelWorkShift(id: string, actorId: string, raw: unknown) {
  const data = workShiftCancelSchema.parse(raw);
  return unitOfWork.withTransaction(async (session) => {
    await lockWorkforceUser(actorId, session, true);
    const shift = await shiftById(id, session);
    // Lock even a disabled employee: cancelling their future schedule remains possible.
    await userRepository.lockAny(shift.staffId, session);
    if (shift.status === 'CANCELLED' && shift.cancelReason === data.reason)
      return toWorkShift(shift);
    checkVersion(shift, data.expectedVersion);
    if (shift.status !== 'SCHEDULED')
      throw new ConflictError('WORK_SHIFT_LOCKED', 'Chỉ hủy được ca chưa vào làm.');
    const before = toWorkShift(shift);
    shift.status = 'CANCELLED';
    shift.cancelReason = data.reason;
    shift.version++;
    await workShiftRepository.save(shift, session);
    await logWorkShiftAudit(actorId, 'cancelled', shift, before, session);
    return toWorkShift(shift);
  });
}
export async function clockWorkShift(
  id: string,
  actorId: string,
  direction: 'in' | 'out',
  raw: unknown,
) {
  const data = workClockSchema.parse(raw);
  return unitOfWork.withTransaction(async (session) => {
    await lockWorkforceUser(actorId, session);
    const shift = await shiftById(id, session);
    if (String(shift.staffId) !== actorId)
      throw new ForbiddenError('Chỉ được chấm công ca của chính mình.');
    if ((direction === 'in' && shift.clockInAt) || (direction === 'out' && shift.clockOutAt))
      return toWorkShift(shift);
    checkVersion(shift, data.expectedVersion);
    const now = workforceClock.now(),
      before = toWorkShift(shift, now);
    if (direction === 'in') {
      if (shift.status !== 'SCHEDULED')
        throw new ConflictError('WORK_SHIFT_LOCKED', 'Ca không còn chờ vào làm.');
      if (now.getTime() < shift.startsAt.getTime() - 30 * 60000 || now >= shift.endsAt)
        throw new ConflictError(
          'CLOCK_WINDOW',
          'Được vào ca từ 30 phút trước giờ bắt đầu đến trước giờ kết thúc.',
        );
      await assertAttendanceFree(actorId, now, null, id, session);
      shift.clockInAt = now;
      shift.effectiveInAt = now;
      shift.status = 'WORKING';
    } else {
      if (shift.status !== 'WORKING')
        throw new ConflictError('WORK_SHIFT_LOCKED', 'Ca chưa vào hoặc đã được quản lý chốt giờ.');
      if (shift.effectiveInAt && now.getTime() - shift.effectiveInAt.getTime() > 24 * HOUR)
        throw new ConflictError(
          'ATTENDANCE_CORRECTION_REQUIRED',
          'Ca mở quá 24 giờ. Nhờ quản lý điều chỉnh giờ thực tế trước khi chấm ca mới.',
        );
      shift.clockOutAt = now;
      shift.effectiveOutAt = now;
      shift.status = 'COMPLETED';
    }
    shift.version++;
    await workShiftRepository.save(shift, session);
    await logWorkShiftAudit(
      actorId,
      direction === 'in' ? 'clockedIn' : 'clockedOut',
      shift,
      before,
      session,
    );
    return toWorkShift(shift, now);
  });
}
export async function correctWorkAttendance(id: string, actorId: string, raw: unknown) {
  const data = workAttendanceCorrectionSchema.parse(raw);
  return unitOfWork.withTransaction(async (session) => {
    const admin = await lockWorkforceUser(actorId, session, true);
    const shift = await shiftById(id, session);
    await userRepository.lockAny(shift.staffId, session);
    if (
      shift.version === data.expectedVersion + 1 &&
      shift.effectiveInAt?.getTime() === Date.parse(data.startsAt) &&
      shift.effectiveOutAt?.getTime() === Date.parse(data.endsAt) &&
      shift.correctionReason === data.reason &&
      shift.correctedByName === admin.name
    )
      return toWorkShift(shift);
    checkVersion(shift, data.expectedVersion);
    if (shift.status === 'CANCELLED')
      throw new ConflictError('WORK_SHIFT_LOCKED', 'Không điều chỉnh ca đã hủy.');
    const start = new Date(data.startsAt),
      end = new Date(data.endsAt);
    if (
      end > workforceClock.now() ||
      start.getTime() < shift.startsAt.getTime() - 12 * HOUR ||
      end.getTime() > shift.endsAt.getTime() + 12 * HOUR
    )
      throw new ValidationError(
        'Giờ thực tế không được ở tương lai và phải nằm trong 12 giờ quanh lịch ca.',
      );
    await assertAttendanceFree(String(shift.staffId), start, end, id, session);
    const before = toWorkShift(shift);
    shift.set({
      effectiveInAt: start,
      effectiveOutAt: end,
      status: 'COMPLETED',
      correctionReason: data.reason,
      correctedByName: admin.name,
      version: shift.version + 1,
    });
    await workShiftRepository.save(shift, session);
    await logWorkShiftAudit(actorId, 'attendanceCorrected', shift, before, session);
    return toWorkShift(shift);
  });
}

export async function saveStaffingPolicy(actorId: string, raw: unknown) {
  const data = staffingPolicySchema.parse(raw);
  for (let i = 0; i < data.rules.length; i++)
    for (const other of data.rules.slice(i + 1)) {
      const rule = data.rules[i]!;
      if (
        rule.day === other.day &&
        rule.startMinute < other.endMinute &&
        rule.endMinute > other.startMinute
      )
        throw new ValidationError(
          'Các khung yêu cầu nhân sự trong cùng ngày không được chồng lấn.',
        );
    }
  return unitOfWork
    .withTransaction(async (session) => {
      await lockWorkforceUser(actorId, session, true);
      const existing = await staffingPolicyRepository.findDefault(session);
      if (
        existing?.version === data.expectedVersion + 1 &&
        JSON.stringify(
          existing.rules.map((r) => ({
            day: r.day,
            startMinute: r.startMinute,
            endMinute: r.endMinute,
            minStaff: r.minStaff,
            label: r.label,
          })),
        ) === JSON.stringify(data.rules) &&
        (existing.ordersPerStaffHour ?? 6) === data.ordersPerStaffHour
      )
        return {
          version: existing.version,
          rules: data.rules,
          ordersPerStaffHour: data.ordersPerStaffHour,
        };
      if ((existing?.version ?? 0) !== data.expectedVersion)
        throw new ConflictError('POLICY_CHANGED', 'Cấu hình đã thay đổi. Hãy tải lại.');
      const before = existing?.toObject() ?? { version: 0, rules: [] };
      const policy = existing ?? staffingPolicyRepository.newDefault();
      policy.set({
        rules: data.rules,
        ordersPerStaffHour: data.ordersPerStaffHour,
        version: data.expectedVersion + 1,
      });
      await staffingPolicyRepository.save(policy, session);
      await auditRepository.log(
        {
          actorType: 'USER',
          actorId,
          action: 'workforce.staffingPolicyChanged',
          entityType: 'StaffingPolicy',
          metadata: { before, after: policy.toObject() },
        },
        session,
      );
      await queueWorkforceChanged(session);
      return {
        version: policy.version,
        rules: data.rules,
        ordersPerStaffHour: data.ordersPerStaffHour,
      };
    })
    .catch((error: unknown) => {
      if ((error as { code?: number }).code === 11000)
        throw new ConflictError(
          'POLICY_CHANGED',
          'Cấu hình vừa được quản lý khác tạo. Hãy tải lại.',
        );
      throw error;
    });
}

/** Called inside the order transaction; no attendance requirement is added to existing KDS flows. */
export async function recordWorkActivity(
  orderId: string,
  stage: string,
  actorId: string,
  session: ClientSession,
) {
  if (!['CONFIRMED', 'PREPARING', 'READY', 'SERVED'].includes(stage)) return;
  const at = workforceClock.now();
  const user = await userRepository.findById(actorId, session);
  const shift = await workShiftRepository.touchWorkingShift(actorId, at, session);
  const preparation =
    stage === 'READY' ? await workActivityRepository.findPreparation(orderId, session) : null;
  await workActivityRepository.create(
    {
      orderId,
      stage,
      staffId: actorId,
      staffName: user?.name ?? 'Nhân viên',
      at,
      workShiftId: shift?._id ?? null,
      preparationStaffId: preparation?.staffId ?? null,
      preparationStaffName: preparation?.staffName ?? '',
      preparationShiftId: preparation?.workShiftId ?? null,
      preparationMs: preparation ? Math.max(0, at.getTime() - preparation.at.getTime()) : null,
    },
    session,
  );
}
