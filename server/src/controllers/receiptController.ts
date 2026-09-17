import type { Request, Response, NextFunction } from 'express';
import { OrderModel } from '../models/Order.js';
import { ReviewModel } from '../models/Review.js';
import { tableSessionRepository } from '../repositories/tableSessionRepository.js';
import { tableRepository } from '../repositories/tableRepository.js';
import { ForbiddenError } from '../errors/AppError.js';

export async function currentReceipt(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.guest) throw new ForbiddenError();
    const { tableSessionId, participantId } = req.guest;
    const session = await tableSessionRepository.findById(tableSessionId);
    const table = session ? await tableRepository.findById(session.tableId.toString()) : null;
    const orders = await OrderModel.find(
      { tableSessionId, participantId, paymentStatus: 'PAID', status: 'SERVED' },
      'code total status paymentStatus items participantId createdAt',
    ).sort({ createdAt: 1 });
    const reviews = await ReviewModel.find({ tableSessionId, participantId });
    res.json({ success: true, data: {
      tableName: table?.name ?? 'Bàn', closedAt: session?.closedAt,
      total: orders.reduce((sum, o) => sum + o.total, 0),
      orders: orders.map((o) => ({
        _id: o._id,
        code: o.code,
        total: o.total,
        status: o.status,
        paymentStatus: o.paymentStatus,
        items: o.items,
        participantId: o.participantId,
        createdAt: o.createdAt,
        review: reviews.find((r) => r.orderId.toString() === o.id) ?? null,
      })),
    } });
  } catch (e) { next(e); }
}
