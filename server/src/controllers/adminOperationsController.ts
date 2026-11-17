import type { Request, Response, NextFunction } from 'express';
import { NotFoundError } from '../errors/AppError.js';
import { operationsSummary } from '../services/operationsService.js';
import { anomalyDashboard, updateAnomalyStatus } from '../services/anomalyService.js';
import { updateAnomalyStatusRequestSchema } from '@may-cafe/contracts';
import { auditRepository } from '../repositories/auditRepository.js';
import { listDeadLetters, replayDeadLetter } from '../infrastructure/backgroundQueue.js';
import { outboxRepository } from '../repositories/outboxRepository.js';

/** Vận hành: số liệu hàng đợi, sự kiện/tác vụ lỗi có thể chạy lại và cảnh báo bất thường. */
export async function operations(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await operationsSummary();
    req.log.info(
      { requestId: req.id, operation: 'admin.operations.read' },
      'operations summary viewed',
    );
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
}

export async function operationFailures(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const [outbox, deadLetters] = await Promise.all([
      outboxRepository.listFailed(),
      listDeadLetters(),
    ]);
    res.json({ success: true, data: { outbox, deadLetters } });
  } catch (error) {
    next(error);
  }
}

export async function replayOutbox(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const eventId = String(req.params['id'] ?? '');
    if (!(await outboxRepository.replayFailed(eventId)))
      throw new NotFoundError('Không tìm thấy sự kiện outbox lỗi.');
    await auditRepository.log({
      actorType: 'USER',
      actorId: req.user!.id,
      action: 'outbox.replayed',
      entityType: 'OutboxEvent',
      entityId: eventId,
    });
    res.json({ success: true, data: { eventId, status: 'PENDING' } });
  } catch (error) {
    next(error);
  }
}

export async function replayQueueJob(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const jobId = String(req.params['id'] ?? '');
    if (!(await replayDeadLetter(jobId)))
      throw new NotFoundError('Không tìm thấy dead-letter job.');
    await auditRepository.log({
      actorType: 'USER',
      actorId: req.user!.id,
      action: 'queueJob.replayed',
      entityType: 'BackgroundJob',
      entityId: jobId,
    });
    res.json({ success: true, data: { jobId, status: 'QUEUED' } });
  } catch (error) {
    next(error);
  }
}

export async function anomalies(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await anomalyDashboard();
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
}

export async function setAnomalyStatus(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = updateAnomalyStatusRequestSchema.parse(req.body);
    const id = String(req.params['id'] ?? '');
    const alert = await updateAnomalyStatus(id, input.status, req.user!.id);
    if (!alert) throw new NotFoundError('Không tìm thấy cảnh báo.');
    await auditRepository.log({
      actorType: 'USER',
      actorId: req.user!.id,
      action: input.status === 'ACKNOWLEDGED' ? 'anomaly.acknowledged' : 'anomaly.closed',
      entityType: 'AnomalyAlert',
      entityId: id,
      metadata: { detector: alert.detector, previousWindowEnd: alert.windowEnd },
    });
    res.json({ success: true, data: { alert } });
  } catch (e) {
    next(e);
  }
}
