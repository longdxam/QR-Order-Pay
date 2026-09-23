import { randomUUID } from 'node:crypto';
import { config } from '../config/index.js';
import { isRedisReady, redisCommandClient } from './redis.js';

export const REALTIME_QUEUE = 'maycafe:queue:realtime';
export const REPORT_QUEUE = 'maycafe:queue:reports';
export const REALTIME_PROCESSING_QUEUE = `${REALTIME_QUEUE}:processing`;
export const REPORT_PROCESSING_QUEUE = `${REPORT_QUEUE}:processing`;
export const DEAD_LETTER_QUEUE = 'maycafe:queue:dead-letter';

export type RealtimeEvent =
  | 'order.created'
  | 'order.statusChanged'
  | 'menu.availabilityChanged'
  | 'serviceRequest.created'
  | 'serviceRequest.resolved'
  | 'payment.confirmed'
  | 'tableSession.statusChanged';

export type RealtimeTarget =
  | { scope: 'all' }
  | { scope: 'staff' }
  | { scope: 'session'; tableSessionId: string }
  | { scope: 'guest'; tableSessionId: string; participantId: string };

interface JobBase {
  id: string;
  attempts: number;
  createdAt: string;
}

export interface RealtimeJob extends JobBase {
  type: 'realtime.notify';
  payload: {
    target: RealtimeTarget;
    event: RealtimeEvent;
    data: unknown;
  };
}

export interface ReportJob extends JobBase {
  type: 'report.overview';
  payload: {
    from: string | null;
    to: string | null;
    format: 'json' | 'csv';
  };
}

export type BackgroundJob = RealtimeJob | ReportJob;

export interface ReportJobState {
  id: string;
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  format: 'json' | 'csv';
  createdAt: string;
  updatedAt: string;
  result?: unknown;
  error?: string;
}

export async function enqueueRealtimeJob(
  target: RealtimeTarget,
  event: RealtimeEvent,
  data: unknown,
): Promise<boolean> {
  if (!isRedisReady()) return false;
  const job: RealtimeJob = {
    id: randomUUID(),
    type: 'realtime.notify',
    attempts: 0,
    createdAt: new Date().toISOString(),
    payload: { target, event, data },
  };
  await redisCommandClient().lpush(REALTIME_QUEUE, JSON.stringify(job));
  return true;
}

export async function enqueueReportJob(input: ReportJob['payload']): Promise<ReportJobState> {
  if (!isRedisReady()) throw new Error('BACKGROUND_QUEUE_UNAVAILABLE');
  const now = new Date().toISOString();
  const job: ReportJob = {
    id: randomUUID(),
    type: 'report.overview',
    attempts: 0,
    createdAt: now,
    payload: input,
  };
  const state: ReportJobState = {
    id: job.id,
    status: 'QUEUED',
    format: input.format,
    createdAt: now,
    updatedAt: now,
  };
  await redisCommandClient()
    .multi()
    .set(reportStateKey(job.id), JSON.stringify(state), 'EX', config.backgroundJobs.resultTtlSeconds)
    .lpush(REPORT_QUEUE, JSON.stringify(job))
    .exec();
  return state;
}

export async function getReportJobState(id: string): Promise<ReportJobState | null> {
  if (!isRedisReady()) return null;
  const raw = await redisCommandClient().get(reportStateKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ReportJobState;
  } catch {
    return null;
  }
}

export async function setReportJobState(state: ReportJobState): Promise<void> {
  await redisCommandClient().set(
    reportStateKey(state.id),
    JSON.stringify({ ...state, updatedAt: new Date().toISOString() }),
    'EX',
    config.backgroundJobs.resultTtlSeconds,
  );
}

export async function recoverProcessingJobs(queue: string, processingQueue: string): Promise<number> {
  let recovered = 0;
  let raw: string | null;
  do {
    raw = await redisCommandClient().rpoplpush(processingQueue, queue);
    if (!raw) break;
    recovered += 1;
  } while (raw);
  return recovered;
}

export async function claimJob(queue: string, processingQueue: string): Promise<{ raw: string; job: BackgroundJob } | null> {
  const raw = await redisCommandClient().rpoplpush(queue, processingQueue);
  if (!raw) return null;
  try {
    return { raw, job: JSON.parse(raw) as BackgroundJob };
  } catch {
    await acknowledgeJob(processingQueue, raw);
    await redisCommandClient().lpush(DEAD_LETTER_QUEUE, raw);
    return null;
  }
}

export async function acknowledgeJob(processingQueue: string, raw: string): Promise<void> {
  await redisCommandClient().lrem(processingQueue, 1, raw);
}

export async function retryOrDeadLetter(
  queue: string,
  processingQueue: string,
  raw: string,
  job: BackgroundJob,
): Promise<boolean> {
  const next = { ...job, attempts: job.attempts + 1 } as BackgroundJob;
  const transaction = redisCommandClient().multi().lrem(processingQueue, 1, raw);
  if (next.attempts < config.backgroundJobs.maxAttempts) {
    transaction.lpush(queue, JSON.stringify(next));
  } else {
    transaction.lpush(DEAD_LETTER_QUEUE, JSON.stringify(next));
  }
  await transaction.exec();
  return next.attempts < config.backgroundJobs.maxAttempts;
}

function reportStateKey(id: string): string {
  return `maycafe:job:report:${id}`;
}
