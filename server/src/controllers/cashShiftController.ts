import type { Request, Response, NextFunction } from 'express';
import { closeCashShiftRequestSchema, openCashShiftRequestSchema } from '@may-cafe/contracts';
import { closeShift, currentShift, listShifts, openShift } from '../services/cashShiftService.js';

export async function current(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ success: true, data: { shift: await currentShift() } });
  } catch (error) {
    next(error);
  }
}
export async function open(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = openCashShiftRequestSchema.parse(req.body);
    res
      .status(201)
      .json({ success: true, data: { shift: await openShift(req.user!.id, input.openingCash) } });
  } catch (error) {
    next(error);
  }
}
export async function close(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = closeCashShiftRequestSchema.parse(req.body);
    res.json({
      success: true,
      data: {
        shift: await closeShift(
          String(req.params['id'] ?? ''),
          req.user!.id,
          input.expectedVersion,
          input.countedCash,
          input.note,
        ),
      },
    });
  } catch (error) {
    next(error);
  }
}
export async function history(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    res.json({ success: true, data: await listShifts(page) });
  } catch (error) {
    next(error);
  }
}
