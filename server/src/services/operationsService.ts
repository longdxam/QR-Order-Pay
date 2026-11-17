import { checkMongoReadiness } from '../infrastructure/mongo.js';
import { getInstanceMetricsSnapshot, setDependencyReadiness } from '../infrastructure/metrics.js';
import { isRedisReady } from '../infrastructure/redis.js';
import { queueSnapshot } from '../infrastructure/backgroundQueue.js';
import { outboxRepository } from '../repositories/outboxRepository.js';
import { orderRepository, staffOrderFeedQuery } from '../repositories/orderRepository.js';
import { serviceRequestRepository } from '../repositories/serviceRequestRepository.js';
import { tableSessionRepository } from '../repositories/tableSessionRepository.js';

const ACTIVE_ORDER_STATUSES = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY'] as const;

export async function operationsSummary() {
  const activeSessions = await tableSessionRepository.listActiveIds();
  const orderScope = staffOrderFeedQuery({
    tableSessionIds: activeSessions.map((session) => String(session._id)),
  });
  const [mongoReady, openServiceRequests, groupedOrders, queues, outbox] = await Promise.all([
    checkMongoReadiness(),
    serviceRequestRepository.countOpen(),
    orderRepository.countByStatus(orderScope),
    queueSnapshot(),
    outboxRepository.statusCounts(),
  ]);

  setDependencyReadiness('mongodb', mongoReady);
  const redisReady = isRedisReady();
  setDependencyReadiness('redis', redisReady);
  const ordersByStatus: Record<(typeof ACTIVE_ORDER_STATUSES)[number], number> = {
    PENDING: 0,
    CONFIRMED: 0,
    PREPARING: 0,
    READY: 0,
  };
  let oldestQueuedAt: Date | null = null;
  for (const row of groupedOrders) {
    if (row._id in ordersByStatus)
      ordersByStatus[row._id as keyof typeof ordersByStatus] = row.count;
    if (!oldestQueuedAt || row.oldestCreatedAt < oldestQueuedAt)
      oldestQueuedAt = row.oldestCreatedAt;
  }

  return {
    observedAt: new Date().toISOString(),
    instance: getInstanceMetricsSnapshot(),
    database: {
      scope: 'database' as const,
      mongodbReady: mongoReady,
      redisReady,
      activeSessions: activeSessions.length,
      openServiceRequests,
      activeOrders: Object.values(ordersByStatus).reduce((sum, count) => sum + count, 0),
      ordersByStatus,
      oldestQueuedAt: oldestQueuedAt?.toISOString() ?? null,
      oldestQueueAgeSeconds: oldestQueuedAt
        ? Math.max(0, Math.floor((Date.now() - oldestQueuedAt.getTime()) / 1_000))
        : 0,
      queues,
      outbox: {
        pending: outbox.PENDING ?? 0,
        processing: outbox.PROCESSING ?? 0,
        published: outbox.PUBLISHED ?? 0,
        failed: outbox.FAILED ?? 0,
      },
    },
  };
}
