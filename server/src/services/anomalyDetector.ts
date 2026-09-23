import type { AnomalyEvaluation } from '@may-cafe/contracts';
import type { HttpObservation } from '../infrastructure/metrics.js';

export interface OrderSignal {
  createdAt: Date;
  status: string;
  preparationStartedAt: Date | null;
  preparationCompletedAt: Date | null;
  cancelledAt: Date | null;
}

export interface AnomalySettings {
  windowMinutes: number;
  baselineMinutes: number;
  minSamples: number;
  errorRateThreshold: number;
  latencyP95Ms: number;
  preparationP95Seconds: number;
  cancellationRateThreshold: number;
  baselineMultiplier: number;
}

export function evaluateAnomalies(input: {
  now: Date;
  http: readonly HttpObservation[];
  orders: readonly OrderSignal[];
  settings: AnomalySettings;
}): AnomalyEvaluation[] {
  const { now, settings } = input;
  const windowMs = Math.max(1, settings.windowMinutes) * 60_000;
  const baselineMs = Math.max(1, settings.baselineMinutes) * 60_000;
  const windowStart = new Date(now.getTime() - windowMs);
  const baselineStart = new Date(windowStart.getTime() - baselineMs);
  const currentHttp = input.http.filter((item) => inWindow(item.at, windowStart, now));
  const baselineHttp = input.http.filter((item) => inWindow(item.at, baselineStart, windowStart));
  const currentOrders = input.orders.filter((item) => inWindow(item.createdAt, windowStart, now));
  const baselineOrders = input.orders.filter((item) => inWindow(item.createdAt, baselineStart, windowStart));

  const currentHttpCount = observationCount(currentHttp);
  const baselineHttpCount = observationCount(baselineHttp);
  const currentErrorCount = observationCount(currentHttp.filter((item) => item.statusCode >= 500));
  const baselineErrorCount = observationCount(baselineHttp.filter((item) => item.statusCode >= 500));
  const currentErrorRate = ratio(currentErrorCount, currentHttpCount);
  const baselineErrorRate = ratio(baselineErrorCount, baselineHttpCount);
  const errorThreshold = Math.max(settings.errorRateThreshold, baselineErrorRate * settings.baselineMultiplier);
  const currentLatency = currentHttp.map((item) => ({ value: item.durationMs, count: item.count ?? 1 }));
  const baselineLatency = baselineHttp.map((item) => ({ value: item.durationMs, count: item.count ?? 1 }));
  const latencyBaselineP95 = weightedPercentile95(baselineLatency);
  const latencyThreshold = Math.max(settings.latencyP95Ms, latencyBaselineP95 * settings.baselineMultiplier);

  const currentPreparation = preparationDurations(input.orders, windowStart, now, now);
  const baselinePreparation = preparationDurations(input.orders, baselineStart, windowStart, now);
  const preparationBaselineP95 = percentile95(baselinePreparation);
  const preparationThreshold = Math.max(settings.preparationP95Seconds, preparationBaselineP95 * settings.baselineMultiplier);

  const currentCancelled = currentOrders.filter((item) => item.cancelledAt && item.cancelledAt < now).length;
  const baselineCancelled = baselineOrders.filter((item) => item.cancelledAt && item.cancelledAt < windowStart).length;
  const currentCancellationRate = ratio(currentCancelled, currentOrders.length);
  const baselineCancellationRate = ratio(baselineCancelled, baselineOrders.length);
  const cancellationThreshold = Math.max(settings.cancellationRateThreshold, baselineCancellationRate * settings.baselineMultiplier);

  return [
    evaluation({
      detector: 'HTTP_ERROR_RATE', now, windowStart, observed: currentErrorRate, baseline: baselineErrorRate,
      threshold: errorThreshold, samples: currentHttpCount, baselineSamples: baselineHttpCount, settings,
      method: 'Tỷ lệ response HTTP 5xx / tổng request trong cửa sổ, so với baseline liền trước và ngưỡng tuyệt đối.',
      evidence: {
        errors: currentErrorCount,
        requests: currentHttpCount,
        topErrorRoutes: topRoutes(currentHttp.filter((item) => item.statusCode >= 500)),
      },
    }),
    evaluation({
      detector: 'HTTP_LATENCY_P95', now, windowStart, observed: weightedPercentile95(currentLatency), baseline: latencyBaselineP95,
      threshold: latencyThreshold, samples: currentHttpCount, baselineSamples: baselineHttpCount, settings,
      method: 'p95 thời gian phản hồi HTTP (ms), so với baseline liền trước và ngưỡng tuyệt đối.',
      evidence: { requests: currentHttpCount, slowestRoutes: slowestRoutes(currentHttp) },
    }),
    evaluation({
      detector: 'PREPARATION_P95', now, windowStart, observed: percentile95(currentPreparation), baseline: preparationBaselineP95,
      threshold: preparationThreshold, samples: currentPreparation.length, baselineSamples: baselinePreparation.length, settings,
      method: 'p95 số giây từ PREPARING đến READY; đơn đang PREPARING được tính theo tuổi hiện tại.',
      evidence: { samples: currentPreparation.length, maximumSeconds: currentPreparation.length ? Math.max(...currentPreparation) : null },
    }),
    evaluation({
      detector: 'CANCELLATION_RATE', now, windowStart, observed: currentCancellationRate, baseline: baselineCancellationRate,
      threshold: cancellationThreshold, samples: currentOrders.length, baselineSamples: baselineOrders.length, settings,
      method: 'Tỷ lệ đơn hiện ở CANCELLED / tổng đơn tạo trong cửa sổ, so với cohort baseline liền trước.',
      evidence: { cancelledOrders: currentCancelled, orders: currentOrders.length },
    }),
  ];
}

function evaluation(input: {
  detector: AnomalyEvaluation['detector'];
  now: Date;
  windowStart: Date;
  observed: number;
  baseline: number;
  threshold: number;
  samples: number;
  baselineSamples: number;
  settings: AnomalySettings;
  method: string;
  evidence: Record<string, unknown>;
}): AnomalyEvaluation {
  const enough = input.samples >= input.settings.minSamples && input.baselineSamples >= input.settings.minSamples;
  const state = !enough ? 'INSUFFICIENT_DATA' : input.observed >= input.threshold ? 'ALERT' : 'OK';
  const severity = state !== 'ALERT' ? 'INFO' : input.observed >= input.threshold * 2 ? 'CRITICAL' : 'WARNING';
  return {
    detector: input.detector,
    target: 'all',
    state,
    severity,
    windowStart: input.windowStart.toISOString(),
    windowEnd: input.now.toISOString(),
    observedValue: enough ? round(input.observed) : null,
    thresholdValue: round(input.threshold),
    baselineValue: input.baselineSamples >= input.settings.minSamples ? round(input.baseline) : null,
    sampleCount: input.samples,
    baselineSampleCount: input.baselineSamples,
    method: input.method,
    evidence: input.evidence,
  };
}

function preparationDurations(orders: readonly OrderSignal[], from: Date, to: Date, now: Date): number[] {
  const values: number[] = [];
  for (const order of orders) {
    if (!order.preparationStartedAt) continue;
    const completedAt = order.preparationCompletedAt;
    if (completedAt && inWindow(completedAt, from, to)) {
      values.push(Math.max(0, (completedAt.getTime() - order.preparationStartedAt.getTime()) / 1_000));
    } else if (!completedAt && order.status === 'PREPARING' && to.getTime() === now.getTime()) {
      values.push(Math.max(0, (now.getTime() - order.preparationStartedAt.getTime()) / 1_000));
    }
  }
  return values;
}

function percentile95(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

function weightedPercentile95(values: readonly { value: number; count: number }[]): number {
  const total = values.reduce((sum, item) => sum + item.count, 0);
  if (total === 0) return 0;
  const target = Math.ceil(total * 0.95);
  let seen = 0;
  for (const item of [...values].sort((a, b) => a.value - b.value)) {
    seen += item.count;
    if (seen >= target) return item.value;
  }
  return values[values.length - 1]?.value ?? 0;
}

function observationCount(values: readonly HttpObservation[]): number {
  return values.reduce((sum, item) => sum + (item.count ?? 1), 0);
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function inWindow(value: Date, from: Date, to: Date): boolean {
  const time = value.getTime();
  return time >= from.getTime() && time < to.getTime();
}

function topRoutes(values: readonly HttpObservation[]): Array<{ route: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of values) counts.set(item.route, (counts.get(item.route) ?? 0) + (item.count ?? 1));
  return [...counts].map(([route, count]) => ({ route, count })).sort((a, b) => b.count - a.count).slice(0, 5);
}

function slowestRoutes(values: readonly HttpObservation[]): Array<{ route: string; p95Ms: number; samples: number }> {
  const groups = new Map<string, Array<{ value: number; count: number }>>();
  for (const item of values) groups.set(item.route, [...(groups.get(item.route) ?? []), { value: item.durationMs, count: item.count ?? 1 }]);
  return [...groups].map(([route, durations]) => ({
    route,
    p95Ms: round(weightedPercentile95(durations)),
    samples: durations.reduce((sum, item) => sum + item.count, 0),
  }))
    .sort((a, b) => b.p95Ms - a.p95Ms).slice(0, 5);
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
