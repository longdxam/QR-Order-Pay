import type { Request, Response, NextFunction } from 'express';
import { placeOrderRequestSchema, reviewRequestSchema } from '@may-cafe/contracts';
import { cancelOrderByGuest, getOrderForGuest, listOrdersForGuest, placeOrder } from '../services/orderService.js';
import { submitReview } from '../services/reviewService.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors/AppError.js';
import { transitionByStaff } from '../services/orderService.js';
import { orderRepository } from '../repositories/orderRepository.js';
import { publishGuest, publishStaff } from '../realtime/socket.js';
import { tableRepository } from '../repositories/tableRepository.js';

function notifyOrder(order: Awaited<ReturnType<typeof getOrderForGuest>>, event: 'order.created' | 'order.statusChanged'): void {
  const payload = { orderId: order.id, tableSessionId: order.tableSessionId.toString(), status: order.status };
  publishStaff(event, payload);
  publishGuest(order.tableSessionId.toString(), order.participantId, event, payload);
}

export async function place(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.guest) throw new ForbiddenError('Vui lòng quét QR tại bàn để đặt món.');
    const input = placeOrderRequestSchema.parse(req.body);
    const idempotencyKey = req.headers['idempotency-key'];
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8) {
      throw new ValidationError('Thiếu header Idempotency-Key.');
    }
    const result = await placeOrder({
      tableSessionId: req.guest.tableSessionId,
      participantId: req.guest.participantId,
      idempotencyKey,
      items: input.items,
      note: input.note,
    });
    if (result.created) notifyOrder(result.order, 'order.created');
    res.status(result.created ? 201 : 200).json({ success: true, data: { order: result.order, created: result.created } });
  } catch (e) {
    next(e);
  }
}

export async function cancel(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.guest) throw new ForbiddenError();
    const id = String(req.params['id'] ?? '');
    const order = await cancelOrderByGuest(id, req.guest.participantId);
    notifyOrder(order, 'order.statusChanged');
    res.json({ success: true, data: { order } });
  } catch (e) {
    next(e);
  }
}

export async function detail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.guest) throw new ForbiddenError();
    const id = String(req.params['id'] ?? '');
    const order = await getOrderForGuest(id, req.guest.participantId);
    res.json({ success: true, data: { order } });
  } catch (e) {
    next(e);
  }
}

export async function listMine(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.guest) throw new ForbiddenError();
    const orders = await listOrdersForGuest(req.guest.participantId, req.guest.tableSessionId);
    res.json({ success: true, data: { orders } });
  } catch (e) {
    next(e);
  }
}

export async function review(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.guest) throw new ForbiddenError();
    const id = String(req.params['id'] ?? '');
    const input = reviewRequestSchema.parse(req.body);
    const created = await submitReview({
      orderId: id,
      participantId: req.guest.participantId,
      rating: input.rating,
      comment: input.comment,
    });
    res.status(201).json({ success: true, data: { review: created } });
  } catch (e) {
    next(e);
  }
}

export async function staffList(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const items = await orderRepository.listForStaff({ status: status as never });
    const tables = await tableRepository.list();
    const names = new Map(tables.map((t) => [t.id, t.name]));
    res.json({ success: true, data: { items: items.map((o) => ({ ...o.toObject(), tableName: names.get(o.tableId.toString()) ?? 'Bàn' })) } });
  } catch (e) {
    next(e);
  }
}

export async function staffGetOne(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = String(req.params['id'] ?? '');
    const order = await orderRepository.findById(id);
    if (!order) {
      res.status(404).json({ success: false, error: { code: 'ORDER_NOT_FOUND', message: 'Không tìm thấy đơn.' } });
      return;
    }
    const tables = await tableRepository.list();
    const table = tables.find((t) => t.id === order.tableId.toString());
    const obj = order.toObject();
    res.json({ success: true, data: { order: { ...obj, tableName: table?.name ?? 'Bàn', tableCode: table?.code ?? '' } } });
  } catch (e) {
    next(e);
  }
}

export async function staffTransition(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw new NotFoundError();
    const id = String(req.params['id'] ?? '');
    const body = req.body as { status?: string; reason?: string };
    if (!body.status) throw new ValidationError('Thiếu trạng thái.');
    const order = await transitionByStaff(id, body.status as never, { id: req.user.id }, body.reason);
    notifyOrder(order, 'order.statusChanged');
    res.json({ success: true, data: { order } });
  } catch (e) {
    next(e);
  }
}

export async function staffConfirmReceipt(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw new NotFoundError();
    const id = String(req.params['id'] ?? '');
    const order = await transitionByStaff(id, 'CONFIRMED', { id: req.user.id });
    notifyOrder(order, 'order.statusChanged');
    res.json({ success: true, data: { order } });
  } catch (e) {
    next(e);
  }
}
