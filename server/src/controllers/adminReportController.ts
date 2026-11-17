import type { Request, Response, NextFunction } from 'express';
import { overview } from '../services/dashboardService.js';
import { AppError, NotFoundError, ValidationError } from '../errors/AppError.js';
import {
  billHistoryDetailSchema,
  billHistoryListResponseSchema,
  billHistoryQuerySchema,
} from '@may-cafe/contracts';
import { enqueueReportJob, getReportJobState } from '../infrastructure/backgroundQueue.js';
import { getBillHistory, listBillHistory } from '../services/billHistoryService.js';
import { parseDate } from './queryParsers.js';

/** Báo cáo kinh doanh, lịch sử hóa đơn và tác vụ báo cáo chạy ở worker. */
export async function reportsOverview(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    const data = await overview(from, to);
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
}

export async function bills(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const filters = billHistoryQuerySchema.parse(req.query);
    const data = billHistoryListResponseSchema.parse(await listBillHistory(filters));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function billDetail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({
      success: true,
      data: billHistoryDetailSchema.parse(await getBillHistory(String(req.params['id'] ?? ''))),
    });
  } catch (error) {
    next(error);
  }
}

export async function createOverviewJob(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const from = parseDate(req.body?.from);
    const to = parseDate(req.body?.to);
    const requestedFormat = req.body?.format;
    if (requestedFormat !== 'json' && requestedFormat !== 'csv') {
      throw new ValidationError('Định dạng báo cáo phải là json hoặc csv.');
    }
    const state = await enqueueReportJob({
      from: from?.toISOString() ?? null,
      to: to?.toISOString() ?? null,
      format: requestedFormat,
    });
    res.status(202).json({ success: true, data: state });
  } catch (error) {
    if ((error as Error).message === 'BACKGROUND_QUEUE_UNAVAILABLE') {
      next(
        new AppError(
          'BACKGROUND_QUEUE_UNAVAILABLE',
          'Worker báo cáo tạm thời không khả dụng.',
          503,
        ),
      );
      return;
    }
    next(error);
  }
}

export async function reportJobStatus(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = String(req.params['id'] ?? '');
    const state = await getReportJobState(id);
    if (!state) throw new NotFoundError('Không tìm thấy tác vụ báo cáo hoặc kết quả đã hết hạn.');
    res.json({ success: true, data: state });
  } catch (error) {
    next(error);
  }
}
