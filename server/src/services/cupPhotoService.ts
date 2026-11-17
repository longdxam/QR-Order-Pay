import crypto from 'node:crypto';
import sharp from 'sharp';
import type { ClientSession } from 'mongoose';
import { z } from 'zod';
import {
  CUP_PHOTO_MAX_BYTES,
  CUP_PHOTO_MAX_PIXELS,
  cupPhotoIdSchema,
  cupPrintInputSchema,
  cupPhotoViewSchema,
  latteArtExportSchema,
  type LatteStyle,
  type CupPrintOrder,
} from '@may-cafe/contracts';
import {
  cupPhotoOwnerRepository,
  cupPhotoRepository,
  cupPrintAttemptRepository,
} from '../repositories/cupPhotoRepository.js';
import { orderRepository } from '../repositories/orderRepository.js';
import { tableSessionRepository } from '../repositories/tableSessionRepository.js';
import { unitOfWork } from '../infrastructure/unitOfWork.js';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../errors/AppError.js';
import { auditRepository } from '../repositories/auditRepository.js';
export interface PhotoActor {
  owner: string;
  tableSessionId?: string;
  userId?: string;
}
const DAY = 86400000;
export function cupPhotoView(photo: {
  id?: string;
  width: number;
  height: number;
  expiresAt: Date;
  kind?: string;
  latteStyle?: string | null;
}) {
  return cupPhotoViewSchema.parse({
    id: photo.id,
    width: photo.width,
    height: photo.height,
    expiresAt: photo.expiresAt.toISOString(),
    ...(photo.kind === 'LATTE_ART' ? { kind: 'LATTE_ART', latteStyle: photo.latteStyle } : {}),
  });
}
export async function lockPhotoOwner(actor: PhotoActor, session: ClientSession) {
  if (
    actor.tableSessionId &&
    !(await tableSessionRepository.touchOpen(actor.tableSessionId, session))
  )
    throw new ForbiddenError('Chỉ xử lý ảnh khi phiên bàn đang mở.');
  await cupPhotoOwnerRepository.lock(actor.owner, new Date(Date.now() + 31 * DAY), session);
}
let processing = 0;
const formats: Record<string, string> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
};
export function photoOwner(tableSessionId: string, participantId: string) {
  return `guest:${tableSessionId}:${participantId}`;
}
export async function normalizeCupPhoto(input: Buffer, mime: string) {
  if (!formats[mime])
    throw new AppError('PHOTO_TYPE', 'Chỉ nhận ảnh JPEG, PNG hoặc WebP tĩnh.', 415);
  if (!input.length || input.length > CUP_PHOTO_MAX_BYTES)
    throw new AppError('PHOTO_SIZE', 'Ảnh tối đa 4 MB.', 413);
  // Reject vector/other decoders before passing bytes to libvips.
  const detected = input.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
    ? 'jpeg'
    : input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? 'png'
      : input.toString('ascii', 0, 4) === 'RIFF' && input.toString('ascii', 8, 12) === 'WEBP'
        ? 'webp'
        : '';
  if (detected !== formats[mime]) throw new ValidationError('Dữ liệu ảnh không đúng định dạng.');
  if (processing >= 2)
    throw new AppError('PHOTO_BUSY', 'Máy chủ đang xử lý ảnh. Thử lại sau ít giây.', 429);
  processing += 1;
  try {
    const image = sharp(input, { limitInputPixels: CUP_PHOTO_MAX_PIXELS, failOn: 'warning' });
    const meta = await image.metadata();
    if (
      meta.format !== detected ||
      (meta.pages ?? 1) > 1 ||
      !meta.width ||
      !meta.height ||
      meta.width < 64 ||
      meta.height < 64
    )
      throw new Error('dimensions/animation');
    const result = await image
      .rotate()
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
    if (result.data.length > 1024 * 1024) throw new Error('output too large');
    return { data: result.data, width: result.info.width, height: result.info.height };
  } catch {
    throw new ValidationError(
      'Ảnh lỗi, ảnh động hoặc kích thước không hợp lệ (64 px tối thiểu, tối đa 16 triệu điểm ảnh).',
    );
  } finally {
    processing -= 1;
  }
}
export async function uploadCupPhoto(
  actor: PhotoActor,
  rawKey: unknown,
  input: Buffer,
  mime: string,
) {
  const requestId = z.string().uuid().parse(rawKey),
    sourceHash = crypto.createHash('sha256').update(mime).update(input).digest('hex');
  const result = await normalizeCupPhoto(input, mime);
  return unitOfWork.withTransaction(async (session) => {
    if (
      actor.tableSessionId &&
      !(await tableSessionRepository.touchOpen(actor.tableSessionId, session))
    )
      throw new ForbiddenError('Chỉ tải ảnh khi phiên bàn đang mở.');
    await cupPhotoOwnerRepository.lock(actor.owner, new Date(Date.now() + 31 * DAY), session);
    const old = await cupPhotoRepository.findByRequest(actor.owner, requestId, session);
    if (old) {
      if (old.sourceHash !== sourceHash)
        throw new ConflictError('PHOTO_REPLAY', 'Yêu cầu tải ảnh đã dùng cho ảnh khác.');
      if (old.expiresAt.getTime() <= Date.now())
        throw new ConflictError('PHOTO_EXPIRED', 'Ảnh đã hết hạn. Hãy chọn ảnh lại.');
      return {
        id: old.id,
        width: old.width,
        height: old.height,
        expiresAt: old.expiresAt.toISOString(),
      };
    }
    if (
      (await cupPhotoRepository.countUploadsSince(
        actor.owner,
        new Date(Date.now() - DAY),
        session,
      )) >= 20
    )
      throw new ConflictError('PHOTO_LIMIT', 'Tối đa 20 ảnh trong 24 giờ.');
    const photo = await cupPhotoRepository.createOne(
      {
        owner: actor.owner,
        requestId,
        sourceHash,
        ...result,
        expiresAt: new Date(Date.now() + DAY),
      },
      session,
    );
    await auditRepository.log(
      {
        actorType: actor.userId ? 'USER' : 'GUEST',
        actorId: actor.userId,
        action: 'cupPhoto.uploaded',
        entityType: 'CupPhoto',
        entityId: photo!.id,
      },
      session,
    );
    return {
      id: photo!.id,
      width: photo!.width,
      height: photo!.height,
      expiresAt: photo!.expiresAt.toISOString(),
    };
  });
}
export async function ownCupPhoto(actor: PhotoActor, id: unknown) {
  const photo = await cupPhotoRepository.findLiveWithData(cupPhotoIdSchema.parse(id), actor.owner);
  if (!photo) throw new NotFoundError('Ảnh không còn hoặc không thuộc bạn.');
  return photo.data;
}
export async function ownCupPhotoDetails(actor: PhotoActor, id: unknown) {
  const photo = await cupPhotoRepository.findLive(cupPhotoIdSchema.parse(id), actor.owner);
  if (!photo) throw new NotFoundError('Ảnh không còn hoặc không thuộc bạn.');
  return cupPhotoView(photo);
}
export async function assertCupPhotos(
  items: { cupPhotoId?: string }[],
  owner: string,
  session?: ClientSession,
  attach = false,
) {
  const ids = [
    ...new Set(items.flatMap((i) => (i.cupPhotoId ? [cupPhotoIdSchema.parse(i.cupPhotoId)] : []))),
  ];
  for (const id of ids) {
    const photo = attach
      ? await cupPhotoRepository.extendLive(id, owner, new Date(Date.now() + 30 * DAY), session)
      : await cupPhotoRepository.findLive(id, owner, session);
    if (!photo)
      throw new ValidationError(
        'Ảnh đính kèm đã hết hạn hoặc không thuộc bạn. Chọn lại ảnh trong giỏ.',
      );
  }
}
async function printItem(rawId: unknown, rawIndex: unknown, session?: ClientSession) {
  const id = cupPhotoIdSchema.parse(rawId),
    index = z.coerce.number().int().min(0).max(9999).parse(rawIndex);
  const order = await orderRepository.findPaidLive(id, session);
  const item = order?.items[index];
  if (!order || !item?.cupPhotoId)
    throw new NotFoundError('Chỉ in ảnh của món trong đơn đã thanh toán, còn hiệu lực.');
  const photo = await cupPhotoRepository.findPrintable(item.cupPhotoId, session);
  if (!photo) throw new NotFoundError('Ảnh đã hết hạn lưu trữ.');
  return { order, item, photo };
}
export async function staffCupPhoto(id: unknown, index: unknown) {
  return (await printItem(id, index)).photo.data;
}
export async function cupPrintFeed(rawPage: unknown) {
  const page = z.coerce.number().int().min(1).max(10000).default(1).parse(rawPage),
    { total, orders } = await orderRepository.pageWithCupPhotos(page);
  const result: CupPrintOrder[] = [];
  for (const order of orders) {
    const ids = order.items.flatMap((i) => (i.cupPhotoId ? [i.cupPhotoId] : []));
    const photos = await cupPhotoRepository.listLive(ids);
    const available = new Map(photos.map((photo) => [photo.id, photo]));
    const counts = await cupPrintAttemptRepository.listForOrder(order._id);
    result.push({
      id: order.id,
      code: order.code,
      destination: order.gift
        ? `${order.gift.recipientTableCode} · ${order.gift.recipientTableName}`
        : order.fulfillmentType !== 'DINE_IN'
          ? 'Nhận tại quầy'
          : 'Phục vụ tại bàn',
      status: order.status,
      createdAt: order.createdAt.toISOString(),
      items: order.items.flatMap((i, index) =>
        i.cupPhotoId
          ? [
              {
                index,
                name: i.nameSnapshot,
                size: i.sizeName ?? '',
                quantity: i.quantity,
                available: available.has(String(i.cupPhotoId)),
                attempts: counts.filter((p) => p.itemIndex === index).length,
                ...(available.get(String(i.cupPhotoId))?.kind === 'LATTE_ART'
                  ? {
                      kind: 'LATTE_ART' as const,
                      latteStyle: available.get(String(i.cupPhotoId))!.latteStyle as LatteStyle,
                    }
                  : {}),
              },
            ]
          : [],
      ),
    });
  }
  return { items: result, page, total, pages: Math.ceil(total / 20) };
}
export async function requestCupPrint(userId: string, input: unknown) {
  return requestCupOutput(userId, cupPrintInputSchema.parse(input));
}
function assertOutputKind(kind: string, paper: string) {
  if ((kind === 'LATTE_ART') !== (paper === 'LATTE_PNG'))
    throw new ValidationError(
      'Latte art dùng xuất file cho máy in đồ uống; ảnh tem dùng chức năng in tem.',
    );
}
async function requestCupOutput(
  userId: string,
  body: { requestId: string; orderId: string; itemIndex: number; copies: number; paper: string },
) {
  const hash = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
  // Unique journal also serializes replay; order write conflicts with cancellation/refund.
  const replay = async () => {
    const old = await cupPrintAttemptRepository.findByRequest(userId, body.requestId);
    if (old && old.hash !== hash)
      throw new ConflictError('PRINT_REPLAY', 'Yêu cầu in đã dùng cho nội dung khác.');
    return old;
  };
  const old = await replay();
  if (old) {
    const { photo } = await printItem(body.orderId, body.itemIndex);
    assertOutputKind(photo.kind, body.paper);
    return { id: old.id, state: body.paper === 'LATTE_PNG' ? 'EXPORT_READY' : 'REQUESTED' };
  }
  try {
    return await unitOfWork.withTransaction(async (session) => {
      const { order, item, photo } = await printItem(body.orderId, body.itemIndex, session);
      assertOutputKind(photo.kind, body.paper);
      if (body.copies > item.quantity)
        throw new ValidationError('Số tem không vượt số cốc của dòng món.');
      await orderRepository.touchVersion(order._id, session);
      const attempt = await cupPrintAttemptRepository.create({ userId, ...body, hash }, session);
      await auditRepository.log(
        {
          actorType: 'USER',
          actorId: userId,
          action:
            body.paper === 'LATTE_PNG' ? 'latteArt.exportRequested' : 'cupPhoto.printRequested',
          entityType: 'Order',
          entityId: order.id,
          metadata: { itemIndex: body.itemIndex, copies: body.copies, paper: body.paper },
        },
        session,
      );
      return { id: attempt!.id, state: body.paper === 'LATTE_PNG' ? 'EXPORT_READY' : 'REQUESTED' };
    });
  } catch (error) {
    const raced = await replay();
    if (raced) {
      const { photo } = await printItem(body.orderId, body.itemIndex);
      assertOutputKind(photo.kind, body.paper);
      return { id: raced.id, state: body.paper === 'LATTE_PNG' ? 'EXPORT_READY' : 'REQUESTED' };
    }
    throw error;
  }
}
export async function exportCupLatteArt(userId: string, input: unknown) {
  const body = latteArtExportSchema.parse(input);
  await requestCupOutput(userId, { ...body, copies: 1, paper: 'LATTE_PNG' });
  const { order, photo } = await printItem(body.orderId, body.itemIndex);
  assertOutputKind(photo.kind, 'LATTE_PNG');
  return {
    data: await sharp(photo.data).png().toBuffer(),
    filename: `latte-${order.code.replace(/[^a-zA-Z0-9_-]/g, '')}-line-${body.itemIndex + 1}.png`,
  };
}
