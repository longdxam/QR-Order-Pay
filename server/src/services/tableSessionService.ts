import { tableSessionRepository } from '../repositories/tableSessionRepository.js';
import { guestSessionRepository } from '../repositories/guestSessionRepository.js';
import { tableRepository } from '../repositories/tableRepository.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../errors/AppError.js';
import { sha256, randomToken } from '../utils/crypto.js';
import { orderRepository } from '../repositories/orderRepository.js';
import type { TableSessionStatus } from '@may-cafe/contracts';
import { OrderModel } from '../models/Order.js';
import { unitOfWork } from '../infrastructure/unitOfWork.js';
import { ServiceRequestModel } from '../models/ServiceRequest.js';

export async function openSession(tableId: string, openedBy: string) {
  const table = await tableRepository.findById(tableId);
  if (!table || !table.isActive) throw new NotFoundError('Bàn không khả dụng.');
  const active = await tableSessionRepository.findActiveByTable(table._id.toString());
  if (active) {
    if (active.status === 'CHECKOUT') {
      // revert to OPEN so they can add more orders
      const reverted = await tableSessionRepository.updateStatus(active._id.toString(), active.version, {
        status: 'OPEN',
      });
      if (!reverted) throw new ConflictError('CONFLICT', 'Phiên đang thay đổi, vui lòng thử lại.');
      return reverted;
    }
    throw new ConflictError('TABLE_SESSION_ALREADY_OPEN', 'Bàn đang có phiên mở, hãy đóng phiên cũ trước.');
  }
  return tableSessionRepository.create({ tableId: table._id.toString(), openedBy });
}

export async function transition(
  id: string,
  expectedVersion: number,
  next: TableSessionStatus,
  closedBy: string | null,
) {
  const session = await tableSessionRepository.findById(id);
  if (!session) throw new NotFoundError('Phiên không tồn tại.');
  const allowed = allowedTransitions(session.status);
  if (!allowed.includes(next)) {
    throw new ConflictError('STATE_TRANSITION_INVALID', `Không thể chuyển phiên từ ${session.status} sang ${next}.`);
  }
  const updated = await unitOfWork.withTransaction(async (mongoSession) => {
    // Updating the session serializes closing against new order creation.
    const result = await tableSessionRepository.updateStatus(id, expectedVersion, { status: next, closedBy }, mongoSession);
    if (!result) throw new ConflictError('CONFLICT', 'Phiên đã thay đổi, vui lòng tải lại.');
    if (next === 'CLOSED') {
      const outstanding = await OrderModel.exists({ tableSessionId: id, status: { $ne: 'CANCELLED' }, paymentStatus: 'UNPAID' }).session(mongoSession);
      if (outstanding) throw new ForbiddenError('Cần xử lý và thanh toán hết đơn trước khi đóng phiên.');
      await guestSessionRepository.revokeByTableSession(id, mongoSession);
      await ServiceRequestModel.updateMany({ tableSessionId: id, status: 'OPEN' }, { $set: { status: 'RESOLVED', resolvedBy: closedBy, resolvedAt: new Date() } }, { session: mongoSession });
    }
    return result;
  });
  if (!updated) throw new ConflictError('CONFLICT', 'Phiên đã được cập nhật bởi người khác, vui lòng tải lại.');
  return updated;
}

function allowedTransitions(from: TableSessionStatus): TableSessionStatus[] {
  if (from === 'OPEN') return ['CHECKOUT', 'CLOSED'];
  if (from === 'CHECKOUT') return ['OPEN', 'CLOSED'];
  return [];
}

export async function joinAsGuest(tablePublicToken: string) {
  const table = await tableRepository.findByPublicTokenHash(sha256(tablePublicToken));
  if (!table || !table.isActive) throw new NotFoundError('Mã QR không hợp lệ hoặc đã hết hạn.');
  const session = await tableSessionRepository.findActiveByTable(table._id.toString());
  if (!session) throw new ForbiddenError('Bàn chưa mở phiên phục vụ, vui lòng báo nhân viên.');
  if (session.status === 'CLOSED') throw new ForbiddenError('Phiên đã đóng.');
  const guestToken = randomToken(32);
  const receiptToken = randomToken(32);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 12);
  const participantId = randomToken(8);
  const created = await guestSessionRepository.create({
    tableSessionId: session._id.toString(),
    participantId,
    tokenHash: sha256(guestToken),
    receiptTokenHash: sha256(receiptToken),
    expiresAt,
  });
  return {
    guestToken,
    receiptToken,
    guestId: created.id,
    participantId,
    tableSession: session,
    table,
  };
}

export async function guestCanOrder(tableSessionId: string): Promise<void> {
  const session = await tableSessionRepository.findById(tableSessionId);
  if (!session) throw new NotFoundError();
  if (session.status === 'CLOSED') throw new ForbiddenError('Phiên đã kết thúc, vui lòng liên hệ nhân viên.');
  if (session.status === 'CHECKOUT')
    throw new ForbiddenError('Phiên đang thanh toán, không thể thêm món mới. Vui lòng liên hệ nhân viên.');
}

export async function listOpenSessions() {
  const sessions = await tableSessionRepository.listOpen();
  return Promise.all(
    sessions.map(async (session) => {
      const table = await tableRepository.findById(session.tableId.toString());
      const orderCount = await orderRepository.list({ tableSessionId: session._id.toString(), limit: 1 });
      return { session, table, orderCount: orderCount.total };
    }),
  );
}
