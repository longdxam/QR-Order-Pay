import type { Request, RequestHandler } from 'express';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from '@prometheus-io/client';
import { config } from '../config/index.js';

type BusinessEvent =
  | 'order_created'
  | 'order_cancelled'
  | 'order_served'
  | 'payment_confirmed'
  | 'table_session_created'
  | 'service_request_created'
  | 'service_request_resolved';

type SocketAudience = 'guest' | 'staff';
type Dependency = 'mongodb' | 'redis';
type OrderStage = 'acceptance' | 'preparation' | 'service';

export interface HttpObservation {
  at: Date;
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
  count?: number;
}

let sharedHttpObservationSink: ((observation: HttpObservation) => void) | null = null;

const registry = new Registry();
registry.setDefaultLabels({ service: 'maycafe-server', instance: config.instanceId });
collectDefaultMetrics({ register: registry, prefix: 'maycafe_process_' });

const httpRequests = new Counter<'method' | 'route' | 'status_class' | 'outcome'>({
  name: 'maycafe_http_requests_total',
  help: 'Completed HTTP requests by bounded route template and status class.',
  labelNames: ['method', 'route', 'status_class', 'outcome'],
  registers: [registry],
});

const httpDuration = new Histogram<'method' | 'route' | 'status_class'>({
  name: 'maycafe_http_request_duration_seconds',
  help: 'HTTP request duration by bounded route template and status class.',
  labelNames: ['method', 'route', 'status_class'],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

const businessEvents = new Counter<'event'>({
  name: 'maycafe_business_events_total',
  help: 'Non-replayed business events completed by this application instance.',
  labelNames: ['event'],
  registers: [registry],
});

const orderStageDuration = new Histogram<'stage'>({
  name: 'maycafe_order_stage_duration_seconds',
  help: 'Completed order stage duration: PENDING to CONFIRMED, PREPARING to READY, or READY to SERVED.',
  labelNames: ['stage'],
  buckets: [15, 30, 60, 120, 300, 600, 900, 1800, 3600],
  registers: [registry],
});

const socketConnections = new Gauge<'audience'>({
  name: 'maycafe_socket_connections',
  help: 'Current authenticated Socket.IO connections on this application instance.',
  labelNames: ['audience'],
  registers: [registry],
});

const dependencyReady = new Gauge<'dependency'>({
  name: 'maycafe_dependency_ready',
  help: 'Last observed dependency readiness (1 ready, 0 unavailable).',
  labelNames: ['dependency'],
  registers: [registry],
});

const startedAt = new Date();
const localBusinessCounts: Record<BusinessEvent, number> = {
  order_created: 0,
  order_cancelled: 0,
  order_served: 0,
  payment_confirmed: 0,
  table_session_created: 0,
  service_request_created: 0,
  service_request_resolved: 0,
};
const localSocketCounts: Record<SocketAudience, number> = { guest: 0, staff: 0 };
const localDependencyState: Record<Dependency, boolean> = { mongodb: false, redis: false };
let localHttpRequests = 0;
let localHttpErrors = 0;
let localHttpClientErrors = 0;
let localHttpRateLimited = 0;
const localStageDurations: Record<OrderStage, { count: number; totalSeconds: number }> = {
  acceptance: { count: 0, totalSeconds: 0 },
  preparation: { count: 0, totalSeconds: 0 },
  service: { count: 0, totalSeconds: 0 },
};
const httpObservations: HttpObservation[] = [];
const MAX_HTTP_OBSERVATIONS = 50_000;

export function getRouteTemplate(req: Request): string {
  const route = req.route as { path?: unknown } | undefined;
  if (typeof route?.path !== 'string') return 'unmatched';
  const template = `${req.baseUrl ?? ''}${route.path}`.replace(/\/+/g, '/');
  return template || '/';
}

export const httpMetrics: RequestHandler = (req, res, next) => {
  const start = process.hrtime.bigint();
  res.once('finish', () => {
    const statusClass = `${Math.floor(res.statusCode / 100)}xx`;
    const durationLabels = {
      method: req.method,
      route: getRouteTemplate(req),
      status_class: statusClass,
    };
    const seconds = Number(process.hrtime.bigint() - start) / 1_000_000_000;
    const route = getRouteTemplate(req);
    httpRequests.inc({ ...durationLabels, outcome: responseOutcome(res.statusCode) });
    httpDuration.observe(durationLabels, seconds);
    const observation = { at: new Date(), method: req.method, route, statusCode: res.statusCode, durationMs: seconds * 1_000 };
    httpObservations.push(observation);
    sharedHttpObservationSink?.(observation);
    if (httpObservations.length > MAX_HTTP_OBSERVATIONS) httpObservations.splice(0, httpObservations.length - MAX_HTTP_OBSERVATIONS);
    localHttpRequests += 1;
    if (res.statusCode >= 500) localHttpErrors += 1;
    else if (res.statusCode === 429) {
      localHttpClientErrors += 1;
      localHttpRateLimited += 1;
    } else if (res.statusCode >= 400) localHttpClientErrors += 1;
  });
  next();
};

export function recordBusinessEvent(event: BusinessEvent): void {
  businessEvents.inc({ event });
  localBusinessCounts[event] += 1;
}

export function recordOrderStageDuration(stage: OrderStage, seconds: number): void {
  if (!Number.isFinite(seconds) || seconds < 0) return;
  orderStageDuration.observe({ stage }, seconds);
  localStageDurations[stage].count += 1;
  localStageDurations[stage].totalSeconds += seconds;
}

export function socketConnected(audience: SocketAudience): void {
  localSocketCounts[audience] += 1;
  socketConnections.set({ audience }, localSocketCounts[audience]);
}

export function socketDisconnected(audience: SocketAudience): void {
  localSocketCounts[audience] = Math.max(0, localSocketCounts[audience] - 1);
  socketConnections.set({ audience }, localSocketCounts[audience]);
}

export function setDependencyReadiness(dependency: Dependency, ready: boolean): void {
  localDependencyState[dependency] = ready;
  dependencyReady.set({ dependency }, ready ? 1 : 0);
}

export async function renderMetrics(): Promise<{ body: string; contentType: string }> {
  return { body: await registry.metrics(), contentType: registry.contentType };
}

export function getInstanceMetricsSnapshot() {
  return {
    scope: 'instance' as const,
    instanceId: config.instanceId,
    startedAt: startedAt.toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    http: {
      requests: localHttpRequests,
      clientErrors: localHttpClientErrors,
      rateLimited: localHttpRateLimited,
      serverErrors: localHttpErrors,
    },
    businessEvents: { ...localBusinessCounts },
    orderStageDurations: Object.fromEntries(
      Object.entries(localStageDurations).map(([stage, value]) => [
        stage,
        {
          count: value.count,
          averageSeconds: value.count > 0 ? value.totalSeconds / value.count : null,
        },
      ]),
    ) as Record<OrderStage, { count: number; averageSeconds: number | null }>,
    sockets: { ...localSocketCounts },
    dependencies: { ...localDependencyState },
    process: {
      rssBytes: process.memoryUsage().rss,
      heapUsedBytes: process.memoryUsage().heapUsed,
    },
  };
}

export function getHttpObservations(since: Date): HttpObservation[] {
  const cutoff = since.getTime();
  return httpObservations.filter((item) => item.at.getTime() >= cutoff).map((item) => ({ ...item }));
}

export function setSharedHttpObservationSink(sink: ((observation: HttpObservation) => void) | null): void {
  sharedHttpObservationSink = sink;
}

export function resetApplicationMetricsForTests(): void {
  httpRequests.reset();
  httpDuration.reset();
  businessEvents.reset();
  orderStageDuration.reset();
  socketConnections.reset();
  dependencyReady.reset();
  localHttpRequests = 0;
  localHttpErrors = 0;
  localHttpClientErrors = 0;
  localHttpRateLimited = 0;
  for (const event of Object.keys(localBusinessCounts) as BusinessEvent[]) localBusinessCounts[event] = 0;
  localSocketCounts.guest = 0;
  localSocketCounts.staff = 0;
  localDependencyState.mongodb = false;
  localDependencyState.redis = false;
  for (const stage of Object.keys(localStageDurations) as OrderStage[]) {
    localStageDurations[stage].count = 0;
    localStageDurations[stage].totalSeconds = 0;
  }
  httpObservations.length = 0;
  sharedHttpObservationSink = null;
}

function responseOutcome(statusCode: number): 'success' | 'redirect' | 'client_error' | 'rate_limited' | 'server_error' {
  if (statusCode >= 500) return 'server_error';
  if (statusCode === 429) return 'rate_limited';
  if (statusCode >= 400) return 'client_error';
  if (statusCode >= 300) return 'redirect';
  return 'success';
}
