import type { Request, Response, NextFunction } from 'express';
import { serviceRequestSchema } from '@may-cafe/contracts';
import { createServiceRequest, resolve, listOpen } from '../services/serviceRequestService.js';
import { ForbiddenError, NotFoundError } from '../errors/AppError.js';
import { recordBusinessEvent } from '../infrastructure/metrics.js';

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.guest) throw new ForbiddenError('Vui lòng quét QR tại bàn.');
    const input = serviceRequestSchema.parse(req.body);
    const result = await createServiceRequest({
      tableSessionId: req.guest.tableSessionId,
      participantId: req.guest.participantId,
      type: input.type,
      note: input.note,
    });
    recordBusinessEvent('service_request_created');
    res.status(201).json({ success: true, data: { serviceRequest: result } });
  } catch (e) {
    next(e);
  }
}

export async function resolveOne(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw new NotFoundError();
    const id = String(req.params['id'] ?? '');
    const updated = await resolve(id, req.user.id);
    recordBusinessEvent('service_request_resolved');
    res.json({ success: true, data: { serviceRequest: updated } });
  } catch (e) {
    next(e);
  }
}

export async function list(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const items = await listOpen();
    res.json({ success: true, data: { items } });
  } catch (e) {
    next(e);
  }
}
