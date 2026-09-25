import type { Request, Response, NextFunction } from 'express';
import { confirmPayment } from '../services/paymentService.js';
import { NotFoundError, ValidationError } from '../errors/AppError.js';
import { buildBill } from '../services/paymentService.js';
import { paymentRequestSchema } from '@may-cafe/contracts';
import { recordBusinessEvent } from '../infrastructure/metrics.js';

export async function confirm(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw new NotFoundError();
    const id = String(req.params['id'] ?? '');
    const body = paymentRequestSchema.parse(req.body);
    const idempotencyKey = req.headers['idempotency-key'];
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8)
      throw new ValidationError('Thiếu Idempotency-Key.');
    const result = await confirmPayment({
      tableSessionId: id,
      expectedVersion: body.expectedVersion,
      amount: body.amount,
      method: body.method,
      staffId: req.user.id,
      idempotencyKey,
      note: body.note,
    });
    if (!result.replayed) {
      recordBusinessEvent('payment_confirmed');
    }
    res.status(result.replayed ? 200 : 201).json({
      success: true,
      data: {
        payment: result.payment,
        orderIds: result.orderIds,
        replayed: result.replayed,
        billId: result.billId,
      },
    });
  } catch (e) {
    next(e);
  }
}

export async function bill(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = String(req.params['id'] ?? '');
    const result = await buildBill(id);
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
}
