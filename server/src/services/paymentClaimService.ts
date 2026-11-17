import type { ClientSession } from 'mongoose';
import { tableSessionRepository } from '../repositories/tableSessionRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { ConflictError } from '../errors/AppError.js';
import { sha256 } from '../utils/crypto.js';
import { cashShiftRepository } from '../repositories/cashShiftRepository.js';
import { unitOfWork } from '../infrastructure/unitOfWork.js';

export const PAYMENT_CLAIM_MS = 120_000;

export async function paymentClaims(ids: string[]) {
  const sessions = await tableSessionRepository.listByIds(ids);
  return new Map(
    sessions.map((s) => [
      s.id,
      s.collectionExpiresAt && s.collectionExpiresAt.getTime() > Date.now()
        ? {
            ownerId: String(s.collectionOwner),
            ownerName: s.collectionOwnerName,
            expiresAt: s.collectionExpiresAt.toISOString(),
          }
        : null,
    ]),
  );
}

export async function claimPayment(id: string, actorId: string, token: string) {
  return unitOfWork.withTransaction(async (session) => {
    const user = await userRepository.findById(actorId, session);
    const now = new Date();
    const claimed = await tableSessionRepository.claimCollection(
      id,
      {
        owner: actorId,
        ownerName: user?.name ?? 'Nhân viên',
        tokenHash: sha256(token),
        now,
        expiresAt: new Date(now.getTime() + PAYMENT_CLAIM_MS),
      },
      session,
    );
    if (!claimed)
      throw new ConflictError(
        'PAYMENT_CLAIMED',
        'Bàn đang được nhân viên khác thu tiền hoặc đã đóng. Vui lòng tải lại.',
      );
    await cashShiftRepository.lockOpen(session);
    return { expiresAt: claimed.collectionExpiresAt, version: claimed.version };
  });
}

export async function guardUnpaidCancellation(id: string, session: ClientSession) {
  const active = await tableSessionRepository.lockUnclaimed(id, session);
  if (!active)
    throw new ConflictError(
      'PAYMENT_CLAIMED',
      'Bàn đang được thu tiền hoặc đã đóng, chưa thể hủy đơn.',
    );
}

export async function releasePaymentClaim(id: string, actorId: string, token: string) {
  await tableSessionRepository.releaseClaim(id, actorId, sha256(token));
}

// A committed receipt releases the claim even if the browser navigates away before its cleanup request.
export async function clearCommittedPaymentClaim(id: string, session: ClientSession) {
  await tableSessionRepository.clearClaim(id, session);
}

// The write guard serializes collection, close, correction and claim takeover.
export async function guardPaymentClaim(
  id: string,
  actorId: string,
  token: string | undefined,
  session: ClientSession,
) {
  if (!token)
    throw new ConflictError('PAYMENT_CLAIM_REQUIRED', 'Hãy nhận quyền thu tiền cho bàn trước.');
  const active = await tableSessionRepository.lockClaimedBy(id, actorId, sha256(token), session);
  if (!active)
    throw new ConflictError(
      'PAYMENT_CLAIM_EXPIRED',
      'Quyền thu tiền đã hết hạn hoặc bàn đã thay đổi. Hãy kiểm tra lại trước khi nhận tiền.',
    );
  return active;
}
