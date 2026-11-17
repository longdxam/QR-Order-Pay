import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  RESERVATION_MINUTES,
  RESERVATION_GRACE_MINUTES,
  reservationCreateSchema,
  reservationSearchSchema,
  reservationActionSchema,
  type Reservation,
} from '@may-cafe/contracts';
import type { ReservationDoc } from '../models/Reservation.js';
import { reservationRepository } from '../repositories/reservationRepository.js';
import { memberRepository } from '../repositories/memberRepository.js';
import { unitOfWork } from '../infrastructure/unitOfWork.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../errors/AppError.js';
import { sha256 } from '../utils/crypto.js';
import { auditRepository } from '../repositories/auditRepository.js';
import { tableSessionRepository } from '../repositories/tableSessionRepository.js';
import { outboxRepository } from '../repositories/outboxRepository.js';
import { logger } from '../infrastructure/logger.js';
import { lockReservationTable, reservationChanged } from './reservationGuards.js';
import { tableRepository } from '../repositories/tableRepository.js';

export interface ReservationActor {
  id: string;
  staff: boolean;
}
const minute = 60000;
function interval(starts: string) {
  const startsAt = new Date(starts),
    now = Date.now();
  if (startsAt.getTime() < now + 15 * minute || startsAt.getTime() > now + 7 * 86400000)
    throw new ValidationError('Chọn giờ đến từ 15 phút đến 7 ngày tới.');
  return { startsAt, endsAt: new Date(startsAt.getTime() + RESERVATION_MINUTES * minute) };
}
const scope = (a: ReservationActor) => (a.staff ? {} : { memberId: a.id });
export function reservationDto(r: ReservationDoc): Reservation {
  return {
    id: r.id,
    code: r.code,
    tableId: r.tableId.toString(),
    tableName: r.tableName,
    partySize: r.partySize,
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
    arrivalDeadline: r.arrivalDeadline.toISOString(),
    name: r.name,
    phone: r.phone,
    note: r.note,
    status: r.status,
    version: r.version,
    tableSessionId: r.tableSessionId?.toString() ?? null,
    checkedInAt: r.checkedInAt?.toISOString() ?? null,
    closedAt: r.closedAt?.toISOString() ?? null,
    reason: r.reason,
  };
}
export async function reservationAvailability(raw: unknown) {
  const input = reservationSearchSchema.parse(raw),
    range = interval(input.startsAt),
    now = new Date();
  const occupied = await reservationRepository.tablesHeldDuring(range.startsAt, range.endsAt, now);
  // Current sessions have no forced end. Treat the next hour as occupied;
  // future bookings still require staff to resolve any overrun at check-in.
  if (range.startsAt.getTime() < now.getTime() + RESERVATION_MINUTES * minute)
    occupied.push(...(await tableSessionRepository.listOccupiedTableIds()));
  const tables = await tableRepository.listAvailableFor(input.partySize, occupied);
  return {
    tables: tables.map((t) => ({ id: t.id, name: t.name, code: t.code, capacity: t.capacity })),
    startsAt: range.startsAt.toISOString(),
    endsAt: range.endsAt.toISOString(),
    durationMinutes: RESERVATION_MINUTES,
    graceMinutes: RESERVATION_GRACE_MINUTES,
  };
}
export async function createReservation(a: ReservationActor, raw: unknown) {
  const input = reservationCreateSchema.parse(raw),
    requestHash = sha256(JSON.stringify(input));
  const replayFilter = {
    actorId: a.id,
    actorType: a.staff ? 'STAFF' : 'MEMBER',
    requestId: input.requestId,
  };
  const replay = async () => {
    const r = await reservationRepository.findByRequest(replayFilter);
    if (!r) return null;
    if (r.requestHash !== requestHash)
      throw new ConflictError('IDEMPOTENCY_CONFLICT', 'Mã yêu cầu đã dùng với nội dung khác.');
    return { reservation: reservationDto(r), created: false };
  };
  const previous = await replay();
  if (previous) return previous;
  const range = interval(input.startsAt);
  try {
    return await unitOfWork.withTransaction(async (session) => {
      if (!a.staff) {
        const member = await memberRepository.lockActive(a.id, session);
        if (!member) throw new ForbiddenError('Thành viên không hoạt động.');
        // Serialize same-member limits even when requests target different tables.
        const existing = await reservationRepository.findByRequest(replayFilter, session);
        if (existing) {
          if (existing.requestHash !== requestHash)
            throw new ConflictError(
              'IDEMPOTENCY_CONFLICT',
              'Mã yêu cầu đã dùng với nội dung khác.',
            );
          return { reservation: reservationDto(existing), created: false };
        }
        const active = await reservationRepository.countLiveForMember(a.id, session);
        if (active >= 3)
          throw new ConflictError(
            'RESERVATION_LIMIT',
            'Bạn đang có 3 lịch đặt. Hãy hủy hoặc hoàn tất lịch cũ.',
          );
        const personalOverlap = await reservationRepository.memberHasLiveOverlap(
          a.id,
          range.startsAt,
          range.endsAt,
          session,
        );
        if (personalOverlap)
          throw new ConflictError(
            'RESERVATION_OVERLAP',
            'Bạn đã có lịch đặt trong khoảng giờ này.',
          );
      }
      const table = await lockReservationTable(input.tableId, session);
      const duplicate = await reservationRepository.findByRequest(replayFilter, session);
      if (duplicate) {
        if (duplicate.requestHash !== requestHash)
          throw new ConflictError('IDEMPOTENCY_CONFLICT', 'Mã yêu cầu đã dùng với nội dung khác.');
        return { reservation: reservationDto(duplicate), created: false };
      }
      if (table.capacity < input.partySize)
        throw new ConflictError('TABLE_TOO_SMALL', 'Bàn không đủ chỗ.');
      const overlap = await reservationRepository.hasLiveOverlap(
        input.tableId,
        range.startsAt,
        range.endsAt,
        session,
      );
      if (overlap)
        throw new ConflictError(
          'TABLE_RESERVED',
          'Bàn vừa được đặt. Vui lòng chọn bàn hoặc giờ khác.',
        );
      if (
        range.startsAt.getTime() < Date.now() + RESERVATION_MINUTES * minute &&
        (await tableSessionRepository.findActiveByTable(input.tableId, session))
      )
        throw new ConflictError(
          'TABLE_OCCUPIED',
          'Bàn đang phục vụ khách. Vui lòng chọn bàn khác.',
        );
      const r = await reservationRepository.create(
        {
          ...input,
          ...range,
          ...replayFilter,
          requestHash,
          memberId: a.staff ? null : a.id,
          tableName: table.name,
          arrivalDeadline: new Date(range.startsAt.getTime() + RESERVATION_GRACE_MINUTES * minute),
          code: `DB-${randomBytes(6).toString('hex').toUpperCase()}`,
        },
        session,
      );
      await auditRepository.log(
        {
          actorType: a.staff ? 'USER' : 'GUEST',
          actorId: a.staff ? a.id : null,
          participantId: a.staff ? null : a.id,
          action: 'reservation.created',
          entityType: 'Reservation',
          entityId: r!.id,
          metadata: {
            tableId: table.id,
            startsAt: range.startsAt.toISOString(),
            partySize: input.partySize,
          },
        },
        session,
      );
      await reservationChanged(r!, session);
      return { reservation: reservationDto(r!), created: true };
    });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) {
      const found = await replay();
      if (found) return found;
    }
    throw e;
  }
}
export async function listReservations(a: ReservationActor, query: unknown) {
  const input = z
    .object({
      page: z.coerce.number().int().min(1).max(100000).default(1),
      history: z.enum(['true', 'false']).default('false'),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    })
    .strict()
    .parse(query);
  if (input.date) {
    const parsed = new Date(`${input.date}T00:00:00+07:00`);
    if (
      !Number.isFinite(parsed.getTime()) ||
      new Date(parsed.getTime() + 7 * 3600000).toISOString().slice(0, 10) !== input.date
    )
      throw new ValidationError('Ngày lọc không hợp lệ.');
  }
  await expireReservations();
  const filter = {
    ...scope(a),
    ...(input.history === 'true' ? {} : { status: { $in: ['CONFIRMED', 'CHECKED_IN'] } }),
    ...(input.date
      ? {
          startsAt: {
            $gte: new Date(`${input.date}T00:00:00+07:00`),
            $lt: new Date(new Date(`${input.date}T00:00:00+07:00`).getTime() + 86400000),
          },
        }
      : {}),
  };
  const [items, total] = await reservationRepository.page(
    filter,
    input.history === 'true',
    input.page,
  );
  return { items: items.map(reservationDto), total };
}
export async function actOnReservation(
  a: ReservationActor,
  id: string,
  kind: 'cancel' | 'check-in',
  raw: unknown,
) {
  const input = reservationActionSchema.parse(raw);
  if (kind === 'check-in' && !a.staff) throw new ForbiddenError();
  return unitOfWork.withTransaction(async (session) => {
    const r = await reservationRepository.findScoped(id, scope(a), session);
    if (!r) throw new NotFoundError('Không tìm thấy lịch đặt.');
    // Safe replay for a response lost after commit; never repeat check-in or close a session.
    if (
      (kind === 'check-in' && ['CHECKED_IN', 'COMPLETED'].includes(r.status)) ||
      (kind === 'cancel' && r.status === 'CANCELLED')
    )
      return reservationDto(r);
    if (r.version !== input.expectedVersion)
      throw new ConflictError('CONFLICT', 'Lịch đặt đã thay đổi. Vui lòng tải lại.');
    if (r.status !== 'CONFIRMED')
      throw new ConflictError('STATE_TRANSITION_INVALID', 'Lịch đặt không còn chờ khách.');
    if (r.arrivalDeadline.getTime() <= Date.now())
      throw new ConflictError('RESERVATION_EXPIRED', 'Lịch đặt đã quá hạn đến 15 phút.');
    const table = await lockReservationTable(r.tableId.toString(), session);
    if (kind === 'check-in') {
      if (Date.now() < r.startsAt.getTime() - RESERVATION_GRACE_MINUTES * minute)
        throw new ConflictError('CHECK_IN_TOO_EARLY', 'Chỉ check-in từ 15 phút trước giờ đặt.');
      if (table.capacity < r.partySize)
        throw new ConflictError('TABLE_TOO_SMALL', 'Bàn không đủ chỗ.');
      if (await tableSessionRepository.findActiveByTable(table.id, session))
        throw new ConflictError(
          'TABLE_OCCUPIED',
          'Bàn còn phiên phục vụ. Hãy xử lý và đóng phiên cũ trước khi check-in.',
        );
      const other = await reservationRepository.hasLiveOverlap(
        table._id,
        new Date(),
        new Date(),
        session,
        r._id,
      );
      if (other)
        throw new ConflictError('TABLE_RESERVED', 'Bàn còn trong thời gian của lịch đặt trước.');
      const opened = await tableSessionRepository.create(
        { tableId: table.id, openedBy: a.id, source: 'STAFF' },
        session,
      );
      r.status = 'CHECKED_IN';
      r.checkedInAt = new Date();
      r.tableSessionId = opened._id;
      await outboxRepository.createRealtimeEvents(
        [
          {
            eventType: 'tableSession.statusChanged',
            aggregateType: 'TableSession',
            aggregateId: opened.id,
            aggregateVersion: opened.version,
            target: { scope: 'staff' },
            payload: { tableSessionId: opened.id, status: opened.status, version: opened.version },
          },
        ],
        session,
      );
    } else {
      if (!input.reason) throw new ValidationError('Nhập lý do hủy (ít nhất 3 ký tự).');
      r.status = 'CANCELLED';
      r.closedAt = new Date();
      r.reason = input.reason;
    }
    r.version += 1;
    await r.save({ session });
    await auditRepository.log(
      {
        actorType: a.staff ? 'USER' : 'GUEST',
        actorId: a.staff ? a.id : null,
        participantId: a.staff ? null : a.id,
        action: `reservation.${kind}`,
        entityType: 'Reservation',
        entityId: r.id,
        metadata: {
          tableId: table.id,
          tableSessionId: r.tableSessionId?.toString() ?? null,
          reason: r.reason,
        },
      },
      session,
    );
    await reservationChanged(r, session);
    return reservationDto(r);
  });
}
export async function expireReservations(now = new Date()) {
  const candidates = await reservationRepository.listOverdue(now);
  let count = 0;
  for (const candidate of candidates) {
    const expired = await unitOfWork.withTransaction(async (session) => {
      await tableRepository.touchAdmission(candidate.tableId, session);
      const r = await reservationRepository.markNoShow(candidate._id, now, session);
      if (!r) return false;
      await auditRepository.log(
        {
          actorType: 'SYSTEM',
          action: 'reservation.noShow',
          entityType: 'Reservation',
          entityId: r.id,
        },
        session,
      );
      await reservationChanged(r, session);
      return true;
    });
    if (expired) count += 1;
  }
  return count;
}
export function startReservationSweeper() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await expireReservations();
    } catch (err) {
      logger.error({ err }, 'reservation expiry failed');
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), 30000);
  timer.unref();
  return () => clearInterval(timer);
}
