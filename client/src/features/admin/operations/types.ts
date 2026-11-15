/** Dá»¯ liá»‡u GET /admin/operations/summary vÃ  /failures. */
export interface OperationsSummary {
  observedAt: string;
  instance: {
    scope: 'instance';
    instanceId: string;
    startedAt: string;
    uptimeSeconds: number;
    http: { requests: number; clientErrors: number; rateLimited: number; serverErrors: number };
    businessEvents: Record<string, number>;
    orderStageDurations: Record<
      'acceptance' | 'preparation' | 'service',
      { count: number; averageSeconds: number | null }
    >;
    sockets: { guest: number; staff: number };
    dependencies: { mongodb: boolean; redis: boolean };
    process: { rssBytes: number; heapUsedBytes: number };
  };
  database: {
    scope: 'database';
    mongodbReady: boolean;
    redisReady: boolean;
    activeSessions: number;
    openServiceRequests: number;
    activeOrders: number;
    ordersByStatus: Record<'PENDING' | 'CONFIRMED' | 'PREPARING' | 'READY', number>;
    oldestQueuedAt: string | null;
    oldestQueueAgeSeconds: number;
    queues: {
      realtime: QueueRuntime;
      reports: QueueRuntime;
      deadLetters: number;
      workers: Array<{
        id: string;
        role: string;
        updatedAt: string;
        lastProgressAt?: string;
        activeJobId?: string | null;
        activeJobStartedAt?: string | null;
      }>;
      redisMemory: { usedBytes: number; maxBytes: number; policy: string; keyCount: number };
    };
    outbox: { pending: number; processing: number; published: number; failed: number };
  };
}
export interface QueueRuntime {
  pending: number;
  processing: number;
  oldestPendingAgeSeconds: number;
  expiredProcessing: number;
  retryingSampleCount: number;
}
export interface Failures {
  outbox: Array<{
    eventId: string;
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    attempts: number;
    lastError: string;
  }>;
  deadLetters: Array<{ job: { id: string; type: string }; error: string; failedAt: string }>;
}
