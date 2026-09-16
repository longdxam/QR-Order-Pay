import type { Request, Response, NextFunction } from 'express';
import { confirmPayment } from '../services/paymentService.js';
import { NotFoundError, ValidationError } from '../errors/AppError.js';
import { buildBill } from '../services/paymentService.js';
import { closeSessionSockets, publishSession, publishStaff } from '../realtime/socket.js';

export async function confirm(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw new NotFoundError();
    const id = String(req.params['id'] ?? '');
    const body = req.body as { amount?: number; method?: 'CASH' | 'BANK_TRANSFER' | 'OTHER'; expectedVersion?: number; note?: string };
    const idempotencyKey = req.headers['idempotency-key'];
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8) throw new ValidationError('Thiếu Idempotency-Key.');
    if (typeof body.amount !== 'number' || typeof body.expectedVersion !== 'number' || !body.method) {
      throw new ValidationError('Thiếu thông tin thanh toán.');
    }
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
      const payload = { tableSessionId: id, status: 'CLOSED' };
      publishSession(id, 'payment.confirmed', payload);
      publishStaff('payment.confirmed', payload);
      publishStaff('tableSession.statusChanged', payload);
      publishStaff('serviceRequest.resolved', payload);
      closeSessionSockets(id);
    }
    res.status(result.replayed ? 200 : 201).json({ success: true, data: { payment: result.payment, orderIds: result.orderIds, replayed: result.replayed, billId: result.billId } });
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
