import type { ClientSession } from 'mongoose';
import { ConflictError, NotFoundError, ValidationError } from '../errors/AppError.js';
import { unitOfWork } from '../infrastructure/unitOfWork.js';
import type { CashShiftDoc } from '../models/CashShift.js';
import { cashShiftRepository } from '../repositories/cashShiftRepository.js';
import { paymentRepository } from '../repositories/paymentRepository.js';
import { tableSessionRepository } from '../repositories/tableSessionRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { auditRepository } from '../repositories/auditRepository.js';
import { randomShortCode } from '../utils/crypto.js';
interface RawShift extends Record<string, unknown> {
  _id: unknown;
  code: string;
  status: 'OPEN' | 'CLOSED';
  openedBy: unknown;
  openedByName: string;
  openedAt: Date;
  openingCash: number;
  closedBy?: unknown;
  closedByName?: string;
  closedAt?: Date | null;
  countedCash?: number | null;
  expectedCash?: number | null;
  difference?: number | null;
  reconciliationNote?: string;
  version: number;
}

export async function ensureOpenShift(
  actorId: string,
  session: ClientSession,
): Promise<CashShiftDoc> {
  // A write guard on the shift serializes payment assignment with shift closing.
  const existing = await cashShiftRepository.lockOpenShift(session);
  if (existing) return existing;
  const user = await userRepository.findById(actorId, session);
  try {
    const created = await cashShiftRepository.create(
      {
        code: shiftCode(),
        openedBy: actorId,
        openedByName: user?.name ?? 'Nhân viên',
        openingCash: 0,
      },
      session,
    );
    if (!created) throw new Error('Failed to open shift');
    await auditRepository.log(
      {
        actorType: 'USER',
        actorId,
        action: 'cashShift.autoOpened',
        entityType: 'CashShift',
        entityId: created.id,
        metadata: { openingCash: 0, reason: 'FIRST_PAYMENT_WITHOUT_OPEN_SHIFT' },
      },
      session,
    );
    return created;
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      const raced = await cashShiftRepository.findOpen(session);
      if (raced) return raced;
    }
    throw error;
  }
}

export async function openShift(actorId: string, openingCash: number) {
  return unitOfWork.withTransaction(async (session) => {
    if (await cashShiftRepository.findOpen(session))
      throw new ConflictError('SHIFT_ALREADY_OPEN', 'Đang có một ca thu ngân mở.');
    const user = await userRepository.findById(actorId, session);
    const shift = await cashShiftRepository.create(
      {
        code: shiftCode(),
        openedBy: actorId,
        openedByName: user?.name ?? 'Nhân viên',
        openingCash,
      },
      session,
    );
    if (!shift) throw new Error('Failed to open shift');
    await auditRepository.log(
      {
        actorType: 'USER',
        actorId,
        action: 'cashShift.opened',
        entityType: 'CashShift',
        entityId: shift.id,
        metadata: { openingCash },
      },
      session,
    );
    return shift;
  });
}

export async function currentShift() {
  const shift = await cashShiftRepository.readOpen();
  if (!shift) return null;
  return shiftSummary(shift as unknown as RawShift);
}

export async function closeShift(
  id: string,
  actorId: string,
  expectedVersion: number,
  countedCash: number,
  note?: string,
) {
  return unitOfWork.withTransaction(async (session) => {
    const shift = await cashShiftRepository.findById(id, session);
    if (!shift) throw new NotFoundError('Không tìm thấy ca.');
    if (shift.status !== 'OPEN' || shift.version !== expectedVersion)
      throw new ConflictError('CONFLICT', 'Ca đã được người khác chốt.');
    if (await tableSessionRepository.hasActiveClaim(session))
      throw new ConflictError(
        'PAYMENT_CLAIMED',
        'Còn bàn đang được thu tiền. Hãy kết thúc thu tiền trước khi chốt ca.',
      );
    const cash = await paymentRepository.cashCollectedInShift(shift._id, session);
    const refunded = await paymentRepository.cashRefundedInShift(shift._id, session);
    const expectedCash = shift.openingCash + (cash?.total ?? 0) - (refunded?.total ?? 0);
    if (countedCash !== expectedCash && (!note || note.trim().length < 3))
      throw new ValidationError('Phải nhập lý do chênh lệch tiền khi chốt ca (ít nhất 3 ký tự).');
    const user = await userRepository.findById(actorId, session);
    const closed = await cashShiftRepository.close(
      id,
      expectedVersion,
      {
        closedBy: actorId,
        closedByName: user?.name ?? 'Nhân viên',
        countedCash,
        expectedCash,
        reconciliationNote: note ?? '',
      },
      session,
    );
    if (!closed) throw new ConflictError('CONFLICT', 'Ca vừa được chốt.');
    await auditRepository.log(
      {
        actorType: 'USER',
        actorId,
        action: 'cashShift.closed',
        entityType: 'CashShift',
        entityId: id,
        metadata: { countedCash, expectedCash, difference: countedCash - expectedCash, note },
      },
      session,
    );
    return shiftSummary(closed.toObject() as unknown as RawShift);
  });
}

export async function listShifts(page = 1, limit = 20) {
  const [items, total] = await cashShiftRepository.page(page, limit);
  return {
    items: await Promise.all(items.map((item) => shiftSummary(item as unknown as RawShift))),
    page,
    limit,
    total,
  };
}

async function shiftSummary(shift: RawShift) {
  const [byMethod, unpaidSessions, refunds, reversals] = await Promise.all([
    paymentRepository.collectedByMethodInShift(shift._id),
    tableSessionRepository.listUnpaidSummaries(),
    paymentRepository.refundedByMethodInShift(shift._id, false),
    paymentRepository.refundedByMethodInShift(shift._id, true),
  ]);
  return {
    id: String(shift._id),
    code: shift.code,
    status: shift.status,
    openedBy: String(shift.openedBy),
    openedByName: shift.openedByName,
    openedAt: shift.openedAt,
    openingCash: shift.openingCash,
    closedBy: shift.closedBy ? String(shift.closedBy) : null,
    closedByName: shift.closedByName || null,
    closedAt: shift.closedAt ?? null,
    countedCash: shift.countedCash ?? null,
    expectedCash: shift.expectedCash ?? null,
    difference: shift.difference ?? null,
    reconciliationNote: shift.reconciliationNote ?? '',
    version: shift.version,
    paymentsByMethod: Object.fromEntries(
      byMethod.map((row) => [row._id, { total: row.total, count: row.count }]),
    ),
    refundsByMethod: Object.fromEntries(
      refunds.map((row) => [row._id, { total: row.total, count: row.count }]),
    ),
    reversalsByMethod: Object.fromEntries(
      reversals.map((row) => [row._id, { total: row.total, count: row.count }]),
    ),
    openSessions: unpaidSessions.length,
    unpaidSessions,
  };
}
function shiftCode(): string {
  return `CA${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomShortCode(4)}`;
}
