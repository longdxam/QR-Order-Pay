import { Emitter } from '@socket.io/redis-emitter';
import { config } from '../config/index.js';
import {
  REPORT_PROCESSING_QUEUE,
  REPORT_QUEUE,
  REALTIME_PROCESSING_QUEUE,
  REALTIME_QUEUE,
  acknowledgeJob,
  claimJob,
  recoverProcessingJobs,
  retryOrDeadLetter,
  setReportJobState,
  type BackgroundJob,
  type RealtimeJob,
  type ReportJob,
} from '../infrastructure/backgroundQueue.js';
import { logger } from '../infrastructure/logger.js';
import { redisCommandClient } from '../infrastructure/redis.js';
import { overview } from './dashboardService.js';
import { overviewToCsv } from './reportExportService.js';

export function startBackgroundJobWorker(): () => void {
  let running = false;
  let stopped = false;

  const drain = async () => {
    if (running || stopped) return;
    running = true;
    try {
      await drainQueue(REALTIME_QUEUE, REALTIME_PROCESSING_QUEUE, 50);
      await drainQueue(REPORT_QUEUE, REPORT_PROCESSING_QUEUE, 1);
    } catch (error) {
      logger.error({ err: error }, 'background queue drain failed');
    } finally {
      running = false;
    }
  };

  void Promise.all([
    recoverProcessingJobs(REALTIME_QUEUE, REALTIME_PROCESSING_QUEUE),
    recoverProcessingJobs(REPORT_QUEUE, REPORT_PROCESSING_QUEUE),
  ]).then(([realtime, reports]) => {
    logger.info({ realtime, reports }, 'background queue recovered');
    void drain();
  }).catch((error) => logger.error({ err: error }, 'background queue recovery failed'));

  const timer = setInterval(() => void drain(), config.backgroundJobs.pollIntervalMs);
  timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

async function drainQueue(queue: string, processingQueue: string, limit: number): Promise<void> {
  for (let index = 0; index < limit; index += 1) {
    const claimed = await claimJob(queue, processingQueue);
    if (!claimed) return;
    try {
      await processJob(claimed.job);
      await acknowledgeJob(processingQueue, claimed.raw);
    } catch (error) {
      const retrying = await retryOrDeadLetter(queue, processingQueue, claimed.raw, claimed.job);
      if (claimed.job.type === 'report.overview') {
        await setReportJobState({
          id: claimed.job.id,
          status: retrying ? 'QUEUED' : 'FAILED',
          format: claimed.job.payload.format,
          createdAt: claimed.job.createdAt,
          updatedAt: new Date().toISOString(),
          error: retrying ? undefined : 'Không thể tạo báo cáo.',
        });
      }
      logger.error({ err: error, jobId: claimed.job.id, jobType: claimed.job.type, retrying }, 'background job failed');
    }
  }
}

async function processJob(job: BackgroundJob): Promise<void> {
  if (job.type === 'realtime.notify') {
    emitRealtime(job);
    return;
  }
  await createReport(job);
}

function emitRealtime(job: RealtimeJob): void {
  const emitter = new Emitter(redisCommandClient());
  const { target, event, data } = job.payload;
  if (target.scope === 'all') emitter.emit(event, data);
  else if (target.scope === 'staff') emitter.to('staff').emit(event, data);
  else if (target.scope === 'session') emitter.to(`session:${target.tableSessionId}`).emit(event, data);
  else emitter.to(`guest:${target.tableSessionId}:${target.participantId}`).emit(event, data);
}

async function createReport(job: ReportJob): Promise<void> {
  await setReportJobState({
    id: job.id,
    status: 'PROCESSING',
    format: job.payload.format,
    createdAt: job.createdAt,
    updatedAt: new Date().toISOString(),
  });
  const data = await overview(
    job.payload.from ? new Date(job.payload.from) : undefined,
    job.payload.to ? new Date(job.payload.to) : undefined,
  );
  await setReportJobState({
    id: job.id,
    status: 'COMPLETED',
    format: job.payload.format,
    createdAt: job.createdAt,
    updatedAt: new Date().toISOString(),
    result: job.payload.format === 'csv' ? overviewToCsv(data, job.payload.from, job.payload.to) : data,
  });
}
