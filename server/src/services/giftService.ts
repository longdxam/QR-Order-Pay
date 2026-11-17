import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { z } from 'zod';
import { giftCreateSchema, giftActionSchema, type GiftView } from '@may-cafe/contracts';
import type { GiftDoc } from '../models/Gift.js';
import { giftRepository } from '../repositories/giftRepository.js';
import { tableSessionRepository } from '../repositories/tableSessionRepository.js';
import { tableRepository } from '../repositories/tableRepository.js';
import { guestSessionRepository } from '../repositories/guestSessionRepository.js';
import { orderRepository } from '../repositories/orderRepository.js';
import { unitOfWork } from '../infrastructure/unitOfWork.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../errors/AppError.js';
import { priceOrderItems } from './orderPricingService.js';
import { giftChanged, lockGiftSessions } from './giftGuards.js';
import { logger } from '../infrastructure/logger.js';
import { assertCupPhotos, photoOwner } from './cupPhotoService.js';

export interface GiftActor {
  tableSessionId: string;
  participantId: string;
}
const WINDOW_MS = 5 * 60000;

export async function giftTables(actor: GiftActor) {
  const source = await tableSessionRepository.findOpen(actor.tableSessionId);
  if (!source) throw new ForbiddenError('Vui lòng vào bàn đang mở để gửi quà.');
  const sessions = await tableSessionRepository.listOpenExcept(source._id);
  const tables = await tableRepository.listActiveExcept(source.tableId);
  const byTable = new Map(sessions.map((s) => [String(s.tableId), s]));
  const guests = await guestSessionRepository.listSessionsWithLiveGuests(
    sessions.map((s) => s._id),
  );
  const occupied = new Set(guests.map(String));
  return {
    items: tables.map((t) => {
      const s = byTable.get(t.id);
      return {
        tableId: t.id,
        name: t.name,
        code: t.code,
        sessionId: s?.id ?? '',
        available: !!s && occupied.has(s.id),
      };
    }),
  };
}

export async function createGift(actor: GiftActor, raw: unknown) {
  const input = giftCreateSchema.parse(raw);
  // Missing/false keeps the hash of anonymous requests made before this option existed.
  const { showSenderTable, ...legacyInput } = input;
  const requestHash = crypto
    .createHash('sha256')
    .update(
      JSON.stringify({ ...legacyInput, ...(showSenderTable ? { showSenderTable: true } : {}) }),
    )
    .digest('hex');
  const owner = { senderSessionId: actor.tableSessionId, senderParticipantId: actor.participantId };
  const replay = async () => {
    const old = await giftRepository.findByRequest(owner, input.requestId);
    if (old && old.requestHash !== requestHash)
      throw new ConflictError('IDEMPOTENCY_CONFLICT', 'Yêu cầu đã dùng cho quà khác.');
    return old ? viewGift(old, actor) : null;
  };
  const old = await replay();
  if (old) return old;
  try {
    return await unitOfWork.withTransaction(async (session) => {
      if (input.recipientSessionId === actor.tableSessionId)
        throw new ForbiddenError('Chọn một bàn khác.');
      await lockGiftSessions([actor.tableSessionId, input.recipientSessionId], session);
      const source = await tableSessionRepository.findById(actor.tableSessionId, session);
      const senderTable = showSenderTable
        ? await tableRepository.findById(String(source!.tableId), session)
        : null;
      if (showSenderTable && !senderTable) throw new NotFoundError('Bàn gửi không tồn tại.');
      const target = await tableSessionRepository.findOpenAtTable(
        input.recipientSessionId,
        input.recipientTableId,
        session,
      );
      const table = await tableRepository.findActive(input.recipientTableId, session);
      const guest = await guestSessionRepository.hasLiveGuest(input.recipientSessionId, session);
      if (!target || !table || !guest)
        throw new ConflictError(
          'GIFT_SESSION_UNAVAILABLE',
          'Bàn nhận chưa có khách hoặc vừa thay đổi.',
        );
      const recent = await giftRepository.countSentSince(
        owner,
        new Date(Date.now() - 10 * 60000),
        session,
      );
      if (
        recent >= 5 ||
        (await giftRepository.countLive(owner, session)) >= 3 ||
        (await giftRepository.countLive({ recipientSessionId: target._id }, session)) >= 5
      )
        throw new ConflictError('GIFT_LIMIT', 'Đã đủ lời mời đang chờ. Vui lòng thử lại sau.');
      const priced = await priceOrderItems(input.items, session);
      await assertCupPhotos(
        input.items,
        photoOwner(actor.tableSessionId, actor.participantId),
        session,
        true,
      );
      const gift = await giftRepository.create(
        {
          ...owner,
          ...input,
          requestHash,
          senderTableName: senderTable?.name ?? null,
          senderTableCode: senderTable?.code ?? null,
          recipientTableName: table.name,
          recipientTableCode: table.code,
          expiresAt: new Date(Date.now() + WINDOW_MS),
          items: input.items.map((i, index) => ({
            ...i,
            name: priced.items[index]!.nameSnapshot,
            variantName: priced.items[index]!.variantNameSnapshot,
            toppingNames: priced.items[index]!.toppingNamesSnapshot,
          })),
        },
        session,
      );
      await giftChanged(gift!, session);
      return viewGift(gift!, actor);
    });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      const raced = await replay();
      if (raced) return raced;
    }
    throw error;
  }
}

function viewGift(gift: GiftDoc, actor: GiftActor, orderStatus: string | null = null): GiftView {
  const sent =
    String(gift.senderSessionId) === actor.tableSessionId &&
    gift.senderParticipantId === actor.participantId;
  return {
    id: gift.id,
    direction: sent ? 'SENT' : 'RECEIVED',
    status: gift.status,
    recipientTableName: gift.recipientTableName,
    showSenderTable: gift.showSenderTable === true,
    ...(gift.showSenderTable === true && gift.senderTableName && gift.senderTableCode
      ? { senderTable: { name: gift.senderTableName, code: gift.senderTableCode } }
      : {}),
    message: gift.message,
    items: gift.items.map((i) => ({
      productId: i.productId,
      variantId: i.variantId ?? null,
      sugarLevel: i.sugarLevel,
      iceLevel: i.iceLevel,
      toppingIds: [...i.toppingIds],
      note: i.note,
      quantity: i.quantity,
      ...(i.cupPhotoId ? { hasCupPhoto: true, ...(sent ? { cupPhotoId: i.cupPhotoId } : {}) } : {}),
      name: i.name,
      variantName: i.variantName,
      toppingNames: [...i.toppingNames],
    })),
    expiresAt: gift.expiresAt.toISOString(),
    createdAt: gift.createdAt.toISOString(),
    version: gift.version,
    orderStatus,
    ...(sent ? { orderId: gift.orderId?.toString() ?? null } : {}),
  };
}

export async function listGifts(actor: GiftActor, raw: unknown) {
  const { page } = z
    .object({ page: z.coerce.number().int().min(1).max(10000).default(1) })
    .parse(raw);
  await expireGifts();
  const filter = {
    $or: [
      { senderSessionId: actor.tableSessionId, senderParticipantId: actor.participantId },
      { recipientSessionId: actor.tableSessionId },
    ],
  };
  const gifts = await giftRepository.page(filter, page);
  const orders = await orderRepository.listStatuses(
    gifts.flatMap((g) => (g.orderId ? [g.orderId] : [])),
  );
  const statuses = new Map(orders.map((o) => [o.id, o.status]));
  const incomingCount = await giftRepository.countIncoming(actor.tableSessionId);
  return {
    items: gifts.map((g) => viewGift(g, actor, statuses.get(String(g.orderId)) ?? null)),
    page,
    total: await giftRepository.count(filter),
    incomingCount,
  };
}

export async function decideGift(actor: GiftActor, id: string, raw: unknown) {
  const input = giftActionSchema.parse(raw);
  await expireGifts();
  return unitOfWork.withTransaction(async (session) => {
    const gift = await giftRepository.findById(id, session);
    if (!gift) throw new NotFoundError('Quà không tồn tại.');
    const sender =
      String(gift.senderSessionId) === actor.tableSessionId &&
      gift.senderParticipantId === actor.participantId;
    const recipient = String(gift.recipientSessionId) === actor.tableSessionId;
    if (input.decision === 'CANCEL' ? !sender : !recipient)
      throw new ForbiddenError('Bạn không có quyền xử lý quà này.');
    const next =
      input.decision === 'ACCEPT'
        ? 'ACCEPTED'
        : input.decision === 'DECLINE'
          ? 'DECLINED'
          : 'CANCELLED';
    // Retry by the same actor after a lost response is safe; another participant must refetch.
    if (
      gift.status === next &&
      gift.version === input.expectedVersion + 1 &&
      gift.decidedByParticipantId === actor.participantId
    )
      return viewGift(gift, actor);
    if (
      gift.version !== input.expectedVersion ||
      gift.expiresAt.getTime() <= Date.now() ||
      !(gift.status === 'PENDING' || (sender && gift.status === 'ACCEPTED'))
    )
      throw new ConflictError('GIFT_CHANGED', 'Quà đã được xử lý hoặc hết hạn. Vui lòng tải lại.');
    await lockGiftSessions(
      [String(gift.senderSessionId), String(gift.recipientSessionId)],
      session,
    );
    gift.status = next;
    gift.version++;
    gift.decidedByParticipantId = actor.participantId;
    if (next === 'ACCEPTED') gift.expiresAt = new Date(Date.now() + WINDOW_MS);
    await gift.save({ session });
    await giftChanged(gift, session);
    return viewGift(gift, actor);
  });
}

export async function expireGifts() {
  const candidates = await giftRepository.listOpenByExpiry();
  let count = 0;
  for (const candidate of candidates)
    await unitOfWork.withTransaction(async (session) => {
      const gift = await giftRepository.findOpen(candidate._id, session);
      if (!gift) return;
      const open = await tableSessionRepository.countOpen(
        [gift.senderSessionId, gift.recipientSessionId],
        session,
      );
      if (gift.expiresAt.getTime() > Date.now() && open === 2) return;
      gift.status = 'EXPIRED';
      gift.version++;
      await gift.save({ session });
      await giftChanged(gift, session);
      count++;
    });
  return count;
}
export function startGiftSweeper() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await expireGifts();
    } catch (err) {
      logger.error({ err }, 'gift expiry failed');
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), 30000);
  timer.unref();
  return () => clearInterval(timer);
}

export const giftIdSchema = z
  .string()
  .refine((id) => mongoose.isValidObjectId(id), 'ID quà không hợp lệ.');
