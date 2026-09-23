import { config } from '../config/index.js';
import { logger } from './logger.js';
import type { HttpObservation } from './metrics.js';
import { isRedisReady, redisCommandClient } from './redis.js';

const LATENCY_BUCKETS_MS = [10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000];

export function recordSharedHttpObservation(observation: HttpObservation): void {
  if (!isRedisReady()) return;
  const minute = minuteStart(observation.at).getTime();
  const bucket = LATENCY_BUCKETS_MS.find((value) => observation.durationMs <= value) ?? 60_000;
  const field = JSON.stringify([observation.method, observation.route, observation.statusCode, bucket]);
  const ttlSeconds = (config.anomaly.windowMinutes + config.anomaly.baselineMinutes + 10) * 60;
  void redisCommandClient().pipeline()
    .hincrby(`maycafe:http:${minute}`, field, 1)
    .expire(`maycafe:http:${minute}`, ttlSeconds)
    .exec()
    .catch((error: unknown) => logger.warn({ err: error }, 'shared HTTP metric write failed'));
}

export async function getSharedHttpObservations(since: Date, until = new Date()): Promise<HttpObservation[]> {
  if (!isRedisReady()) return [];
  const starts: Date[] = [];
  for (let at = minuteStart(since); at <= until; at = new Date(at.getTime() + 60_000)) starts.push(at);
  const rows = await Promise.all(starts.map(async (at) => ({ at, values: await redisCommandClient().hgetall(`maycafe:http:${at.getTime()}`) })));
  const observations: HttpObservation[] = [];
  for (const row of rows) {
    for (const [field, rawCount] of Object.entries(row.values)) {
      try {
        const [method, route, statusCode, durationMs] = JSON.parse(field) as [string, string, number, number];
        observations.push({ at: row.at, method, route, statusCode, durationMs, count: Number(rawCount) });
      } catch (error) {
        logger.warn({ err: error }, 'invalid shared HTTP metric ignored');
      }
    }
  }
  return observations;
}

function minuteStart(value: Date): Date {
  return new Date(Math.floor(value.getTime() / 60_000) * 60_000);
}
