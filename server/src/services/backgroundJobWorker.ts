import { Emitter } from '@socket.io/redis-emitter';
import { config } from '../config/index.js';
import {
  REPORT_PROCESSING_QUEUE,
  REPORT_QUEUE,
  REALTIME_PROCESSING_QUEUE,
  REALTIME_QUEUE,
  acknowledgeJob,
  claimJob,
  recoverExpiredJobs,
  renewJobLease,
  retryOrDeadLetter,
  setReportJobState,
  type BackgroundJob,
  type ClaimedJob,
  type RealtimeJob,
  type ReportJob,
} from '../infrastructure/backgroundQueue.js';
import { logger } from '../infrastructure/logger.js';
import { redisCommandClient } from '../infrastructure/redis.js';
import { overview } from './dashboardService.js';
import { overviewToCsv } from './reportExportService.js';
import { invalidatePublicMenuCache } from './menuService.js';

export type QueueWorkerRole = 'realtime' | 'report';
export interface QueueWorker {
  stop: () => Promise<void>;
  drainOnce: () => Promise<number>;
  health: () => QueueWorkerHealth;
}

export interface QueueWorkerHealth {
  role: QueueWorkerRole;
  lastProgressAt: string;
  activeJobId: string | null;
  activeJobStartedAt: string | null;
}

export function startRealtimeJobWorker(): QueueWorker {
  return startQueueWorker('realtime', REALTIME_QUEUE, REALTIME_PROCESSING_QUEUE, 50);
}

export function startReportJobWorker(): QueueWorker {
  return startQueueWorker('report', REPORT_QUEUE, REPORT_PROCESSING_QUEUE, 1);
}

/** Development-compatible wrapper. Production starts each role in its own process. */
export function startBackgroundJobWorker(): QueueWorker {
  const realtime = startRealtimeJobWorker();
  const report = startReportJobWorker();
  return {
    drainOnce: async () => (await realtime.drainOnce()) + (await report.drainOnce()),
    health: () => {
      const states = [realtime.health(), report.health()];
      const oldest = states.sort(
        (left, right) => Date.parse(left.lastProgressAt) - Date.parse(right.lastProgressAt),
      )[0]!;
      return { ...oldest, role: 'realtime' };
    },
    stop: async () => {
      await Promise.all([realtime.stop(), report.stop()]);
    },
  };
}

function startQueueWorker(
  role: QueueWorkerRole,
  queue: string,
  processingQueue: string,
  batchSize: number,
): QueueWorker {
  const owner = `${config.instanceId}:${role}:${process.pid}`;
  const health: QueueWorkerHealth = {
    role,
    lastProgressAt: new Date().toISOString(),
    activeJobId: null,
    activeJobStartedAt: null,
  };
  let stopped = false;
  let running: Promise<number> | null = null;

  const drainOnce = (): Promise<number> => {
    if (stopped) return Promise.resolve(0);
    if (running) return running;
    health.lastProgressAt = new Date().toISOString();
    running = drainQueue(queue, processingQueue, batchSize, owner, health)
      .catch((error) => {
        logger.error({ err: error, queueRole: role }, 'background queue drain failed');
        return 0;
      })
      .finally(() => {
        running = null;
      });
    return running;
  };

  void recoverExpiredJobs(queue, processingQueue)
    .then((recovered) => {
      logger.info({ role, recovered }, 'expired background jobs recovered');
      void drainOnce();
    })
    .catch((error) => logger.error({ err: error, role }, 'background queue recovery failed'));

  const drainTimer = setInterval(() => void drainOnce(), config.backgroundJobs.pollIntervalMs);
  const recoverTimer = setInterval(
    () =>
      void recoverExpiredJobs(queue, processingQueue).catch((error) =>
        logger.error({ err: error, role }, 'job reclaim failed'),
      ),
    config.backgroundJobs.leaseMs,
  );
  drainTimer.unref();
  recoverTimer.unref();

  return {
    drainOnce,
    health: () => ({ ...health }),
    stop: async () => {
      stopped = true;
      clearInterval(drainTimer);
      clearInterval(recoverTimer);
      if (running) await running;
    },
  };
}

async function drainQueue(
  queue: string,
  processingQueue: string,
  limit: number,
  owner: string,
  health: QueueWorkerHealth,
): Promise<number> {
  let processed = 0;
  for (let index = 0; index < limit; index += 1) {
    const claimed = await claimJob(queue, processingQueue, owner);
    if (!claimed) return processed;
    health.activeJobId = claimed.job.id;
    health.activeJobStartedAt = new Date().toISOString();
    health.lastProgressAt = health.activeJobStartedAt;
    const leaseTimer = setInterval(
      () =>
        void renewJobLease(claimed).then((renewed) => {
          if (renewed) health.lastProgressAt = new Date().toISOString();
        }),
      Math.max(1_000, Math.floor(config.backgroundJobs.leaseMs / 3)),
    );
    leaseTimer.unref();
    try {
      await processJob(claimed.job);
      if (!(await acknowledgeJob(processingQueue, claimed))) throw new Error('JOB_LEASE_LOST');
      processed += 1;
      health.lastProgressAt = new Date().toISOString();
    } catch (error) {
      await handleFailure(queue, processingQueue, claimed, error);
    } finally {
      clearInterval(leaseTimer);
      health.activeJobId = null;
      health.activeJobStartedAt = null;
      health.lastProgressAt = new Date().toISOString();
    }
  }
  return processed;
}

async function handleFailure(
  queue: string,
  processingQueue: string,
  claimed: ClaimedJob,
  error: unknown,
): Promise<void> {
  if ((error as Error).message === 'JOB_LEASE_LOST') {
    logger.warn(
      { jobId: claimed.job.id, owner: claimed.owner },
      'job lease lost; result left for current owner',
    );
    return;
  }
  const retrying = await retryOrDeadLetter(queue, processingQueue, claimed, error);
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
  logger.error(
    { err: error, jobId: claimed.job.id, jobType: claimed.job.type, retrying },
    'background job failed',
  );
}

async function processJob(job: BackgroundJob): Promise<void> {
  if (job.type === 'realtime.notify') {
    if (job.payload.event === 'menu.availabilityChanged') await invalidatePublicMenuCache();
    emitRealtime(job);
    return;
  }
  await createReport(job);
}

function emitRealtime(job: RealtimeJob): void {
  const emitter = new Emitter(redisCommandClient());
  const { target, event, envelope } = job.payload;
  if (target.scope === 'all') emitter.emit(event, envelope);
  else if (target.scope === 'staff') emitter.to('staff').emit(event, envelope);
  else if (target.scope === 'session') {
    const room = `session:${target.tableSessionId}`;
    emitter.to(room).emit(event, envelope);
    if (
      event === 'payment.confirmed' ||
      (event === 'tableSession.statusChanged' && hasClosedStatus(envelope.data))
    ) {
      emitter.in(room).disconnectSockets(true);
    }
  } else emitter.to(`guest:${target.tableSessionId}:${target.participantId}`).emit(event, envelope);
}

function hasClosedStatus(data: unknown): boolean {
  return data !== null && typeof data === 'object' && 'status' in data && data.status === 'CLOSED';
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
  const result =
    job.payload.format === 'csv' ? overviewToCsv(data, job.payload.from, job.payload.to) : data;
  assertReportResultSize(result);
  await setReportJobState({
    id: job.id,
    status: 'COMPLETED',
    format: job.payload.format,
    createdAt: job.createdAt,
    updatedAt: new Date().toISOString(),
    result,
  });
}

export function assertReportResultSize(
  result: unknown,
  maxBytes = config.backgroundJobs.resultMaxBytes,
): void {
  const serialized = typeof result === 'string' ? result : JSON.stringify(result);
  const sizeBytes = Buffer.byteLength(serialized, 'utf8');
  if (sizeBytes > maxBytes)
    throw new Error(`REPORT_RESULT_TOO_LARGE size=${sizeBytes} max=${maxBytes}`);
}
