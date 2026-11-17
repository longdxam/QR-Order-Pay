import { Types, type ClientSession } from 'mongoose';
import type { WorkShiftDoc } from '../models/WorkShift.js';
import { userRepository } from '../repositories/userRepository.js';
import { workShiftRepository } from '../repositories/workforceRepository.js';
import { auditRepository } from '../repositories/auditRepository.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../errors/AppError.js';
import { queueWorkforceChanged } from './workforceRealtimeService.js';
import { toWorkShift } from './workforceShiftDto.js';

function validId(id: string) {
  if (!Types.ObjectId.isValid(id)) throw new ValidationError('Mã ca/nhân viên không hợp lệ.');
}

/** Khóa tài khoản còn hoạt động (Admin nếu `admin`) trong transaction; không còn thì 403. */
export async function lockWorkforceUser(id: string, session: ClientSession, admin = false) {
  validId(id);
  const user = await userRepository.lockActive(id, session, admin ? 'ADMIN' : undefined);
  if (!user) throw new ForbiddenError('Tài khoản không còn hoạt động hoặc không có quyền.');
  return user;
}

export async function shiftById(id: string, session: ClientSession) {
  validId(id);
  const shift = await workShiftRepository.findById(id, session);
  if (!shift) throw new NotFoundError('Không tìm thấy lịch ca.');
  return shift;
}

export function checkVersion(shift: WorkShiftDoc, version: number) {
  if (shift.version !== version)
    throw new ConflictError(
      'WORK_SHIFT_CHANGED',
      'Ca đã thay đổi. Hãy tải lại trước khi thao tác.',
    );
}

export async function logWorkShiftAudit(
  actorId: string,
  action: string,
  shift: WorkShiftDoc,
  before: unknown,
  session: ClientSession,
  notify = true,
) {
  await auditRepository.log(
    {
      actorType: 'USER',
      actorId,
      action: `workforce.${action}`,
      entityType: 'WorkShift',
      entityId: shift.id,
      metadata: { before, after: toWorkShift(shift) },
    },
    session,
  );
  if (notify) await queueWorkforceChanged(session);
}

export async function assertWorkScheduleFree(
  staffId: string,
  start: Date,
  end: Date,
  except: string | null,
  session: ClientSession,
) {
  if (await workShiftRepository.hasScheduleOverlap(staffId, start, end, except, session))
    throw new ConflictError('WORK_SHIFT_OVERLAP', 'Nhân viên đã có ca trùng thời gian.');
}

export async function assertAttendanceFree(
  staffId: string,
  start: Date,
  end: Date | null,
  except: string,
  session: ClientSession,
) {
  if (await workShiftRepository.hasAttendanceOverlap(staffId, start, end, except, session))
    throw new ConflictError(
      'ATTENDANCE_OVERLAP',
      'Giờ làm thực tế trùng ca khác hoặc còn ca chưa ra.',
    );
}
