import type { Request, Response, NextFunction } from 'express';
import { ForbiddenError } from '../errors/AppError.js';
import { buildParticipantReceipt } from '../services/receiptService.js';
import { receiptResponseSchema } from '@may-cafe/contracts';

export async function currentReceipt(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.guest) throw new ForbiddenError();
    const data = receiptResponseSchema.parse(
      await buildParticipantReceipt(req.guest.tableSessionId, req.guest.participantId),
    );
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}
