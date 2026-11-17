import type { ClientSession } from 'mongoose';
import { RESERVATION_MINUTES } from '@may-cafe/contracts';
import type { ReservationDoc } from '../models/Reservation.js';
import { reservationRepository } from '../repositories/reservationRepository.js';
import { tableRepository } from '../repositories/tableRepository.js';
import { ConflictError, NotFoundError } from '../errors/AppError.js';
import { outboxRepository } from '../repositories/outboxRepository.js';
import { auditRepository } from '../repositories/auditRepository.js';

// Booking, QR admission, staff opening, transfer and table edits all write the
// same Table document inside their transaction, preventing snapshot write skew.
export async function lockReservationTable(id: string, session: ClientSession) {
  const table = await tableRepository.lockActive(id, session);
  if (!table) throw new NotFoundError('Bàn không khả dụng.');
  return table;
}
export async function assertWalkInAllowed(tableId: string, session: ClientSession) {
  const now = new Date();
  const held = await reservationRepository.hasLiveOverlap(
    tableId,
    now,
    new Date(now.getTime() + RESERVATION_MINUTES * 60000),
    session,
    undefined,
    now,
  );
  if (held)
    throw new ConflictError(
      'TABLE_RESERVED',
      'Bàn có lịch đặt trong 60 phút tới. Vui lòng chọn bàn khác hoặc check-in lịch đặt.',
    );
}
export async function reservationChanged(r: ReservationDoc, session: ClientSession) {
  await outboxRepository.createRealtimeEvents(
    [
      {
        eventType: 'reservation.changed',
        aggregateType: 'Reservation',
        aggregateId: r.id,
        aggregateVersion: r.version,
        target: { scope: 'staff' },
        // Contact details are available only from authenticated list endpoints.
        payload: { id: r.id, status: r.status, version: r.version },
      },
    ],
    session,
  );
}
export async function completeSessionReservation(tableSessionId: string, session: ClientSession) {
  const r = await reservationRepository.completeCheckedIn(tableSessionId, session);
  if (!r) return;
  await auditRepository.log(
    {
      actorType: 'SYSTEM',
      action: 'reservation.completed',
      entityType: 'Reservation',
      entityId: r.id,
      metadata: { tableSessionId },
    },
    session,
  );
  await reservationChanged(r, session);
}
export async function moveSessionReservation(
  tableSessionId: string,
  tableId: string,
  session: ClientSession,
) {
  const r = await reservationRepository.findCheckedIn(tableSessionId, session);
  if (!r) return;
  const table = await tableRepository.findById(tableId, session);
  if (!table || table.capacity < r.partySize)
    throw new ConflictError('TABLE_TOO_SMALL', 'Bàn đích không đủ chỗ cho lịch đặt.');
  const overlap = await reservationRepository.hasLiveOverlap(
    tableId,
    r.startsAt,
    r.endsAt,
    session,
    r._id,
  );
  if (overlap) throw new ConflictError('TABLE_RESERVED', 'Bàn đích trùng lịch đặt.');
  r.tableId = table._id;
  r.tableName = table.name;
  r.version += 1;
  await reservationRepository.save(r, session);
  await reservationChanged(r, session);
}
