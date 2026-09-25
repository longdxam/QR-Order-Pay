import {
  DEAD_LETTER_QUEUE,
  REPORT_PROCESSING_QUEUE,
  REPORT_QUEUE,
  REALTIME_PROCESSING_QUEUE,
  REALTIME_QUEUE,
  acknowledgeJob,
  claimJob,
  enqueueRealtimeJob,
  enqueueReportJob,
  listDeadLetters,
  recoverExpiredJobs,
  replayDeadLetter,
  retryOrDeadLetter,
} from '../src/infrastructure/backgroundQueue.js';
import { connectRedis, disconnectRedis, redisCommandClient } from '../src/infrastructure/redis.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  assert(process.env.QUEUE_DRILL_CONFIRM_ISOLATED === 'yes', 'QUEUE_DRILL_REQUIRES_ISOLATED_REDIS');
  assert(/\/15\/?$/.test(process.env.REDIS_URL ?? ''), 'QUEUE_DRILL_REQUIRES_REDIS_DB_15');
  await connectRedis();
  const redis = redisCommandClient();
  const initialCount = await redis
    .multi()
    .llen(REALTIME_QUEUE)
    .llen(REALTIME_PROCESSING_QUEUE)
    .llen(REPORT_QUEUE)
    .llen(REPORT_PROCESSING_QUEUE)
    .llen(DEAD_LETTER_QUEUE)
    .exec();
  assert(
    initialCount?.every((entry) => Number(entry[1]) === 0),
    'QUEUE_DRILL_REDIS_NOT_EMPTY',
  );

  await enqueueReportJob({ from: null, to: null, format: 'json' });
  const longReportClaim = await claimJob(REPORT_QUEUE, REPORT_PROCESSING_QUEUE, 'report-worker');
  assert(longReportClaim, 'QUEUE_DRILL_REPORT_CLAIM_FAILED');
  await enqueueRealtimeJob(
    { scope: 'staff' },
    'order.created',
    { orderId: 'isolation-order', version: 1 },
    { id: 'queue-drill-isolation', entityId: 'isolation-order', entityVersion: 1 },
  );
  const isolatedRealtimeClaim = await claimJob(
    REALTIME_QUEUE,
    REALTIME_PROCESSING_QUEUE,
    'realtime-worker',
  );
  assert(isolatedRealtimeClaim, 'QUEUE_DRILL_REALTIME_BLOCKED_BY_REPORT');
  assert(
    await acknowledgeJob(REALTIME_PROCESSING_QUEUE, isolatedRealtimeClaim),
    'QUEUE_DRILL_REALTIME_ISOLATION_ACK_FAILED',
  );
  assert(
    await acknowledgeJob(REPORT_PROCESSING_QUEUE, longReportClaim),
    'QUEUE_DRILL_REPORT_ISOLATION_ACK_FAILED',
  );

  await enqueueRealtimeJob(
    { scope: 'staff' },
    'order.created',
    { orderId: 'lease-recovery-order', version: 1 },
    { id: 'queue-drill-lease', entityId: 'lease-recovery-order', entityVersion: 1 },
  );
  const firstClaim = await claimJob(REALTIME_QUEUE, REALTIME_PROCESSING_QUEUE, 'worker-a');
  assert(firstClaim, 'QUEUE_DRILL_FIRST_CLAIM_FAILED');
  const forgedAck = await acknowledgeJob(REALTIME_PROCESSING_QUEUE, {
    ...firstClaim,
    leaseToken: 'not-the-owner-token',
    owner: 'worker-b',
  });
  assert(!forgedAck, 'QUEUE_DRILL_FOREIGN_ACK_WAS_ACCEPTED');

  await new Promise((resolve) => setTimeout(resolve, 350));
  assert(
    (await recoverExpiredJobs(REALTIME_QUEUE, REALTIME_PROCESSING_QUEUE)) === 1,
    'QUEUE_DRILL_EXPIRED_JOB_NOT_RECOVERED',
  );
  const recoveredClaim = await claimJob(REALTIME_QUEUE, REALTIME_PROCESSING_QUEUE, 'worker-b');
  assert(recoveredClaim?.job.id === firstClaim.job.id, 'QUEUE_DRILL_RECOVERED_WRONG_JOB');
  assert(
    await acknowledgeJob(REALTIME_PROCESSING_QUEUE, recoveredClaim),
    'QUEUE_DRILL_RECOVERED_ACK_FAILED',
  );

  await enqueueRealtimeJob(
    { scope: 'staff' },
    'order.created',
    { orderId: 'dead-letter-order', version: 1 },
    { id: 'queue-drill-dead-letter', entityId: 'dead-letter-order', entityVersion: 1 },
  );
  const failedClaim = await claimJob(REALTIME_QUEUE, REALTIME_PROCESSING_QUEUE, 'worker-a');
  assert(failedClaim, 'QUEUE_DRILL_FAILURE_CLAIM_FAILED');
  assert(
    !(await retryOrDeadLetter(
      REALTIME_QUEUE,
      REALTIME_PROCESSING_QUEUE,
      failedClaim,
      new Error('expected drill failure'),
    )),
    'QUEUE_DRILL_JOB_DID_NOT_DEAD_LETTER',
  );
  assert(
    (await listDeadLetters()).some((record) => record.job.id === failedClaim.job.id),
    'QUEUE_DRILL_DEAD_LETTER_MISSING',
  );
  assert(await replayDeadLetter(failedClaim.job.id), 'QUEUE_DRILL_REPLAY_FAILED');
  const replayedClaim = await claimJob(REALTIME_QUEUE, REALTIME_PROCESSING_QUEUE, 'worker-b');
  assert(replayedClaim?.job.id === failedClaim.job.id, 'QUEUE_DRILL_REPLAYED_WRONG_JOB');
  assert(
    await acknowledgeJob(REALTIME_PROCESSING_QUEUE, replayedClaim),
    'QUEUE_DRILL_REPLAY_ACK_FAILED',
  );

  const finalCounts = {
    pending: await redis.llen(REALTIME_QUEUE),
    processing: await redis.llen(REALTIME_PROCESSING_QUEUE),
    reportsPending: await redis.llen(REPORT_QUEUE),
    reportsProcessing: await redis.llen(REPORT_PROCESSING_QUEUE),
    deadLetters: await redis.llen(DEAD_LETTER_QUEUE),
  };
  assert(
    Object.values(finalCounts).every((count) => count === 0),
    'QUEUE_DRILL_NOT_DRAINED',
  );
  process.stdout.write(
    `${JSON.stringify({ reportIsolation: true, foreignAckRejected: true, expiredLeaseRecovered: true, deadLetterReplay: true, finalCounts })}\n`,
  );
}

void main()
  .catch((error) => {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exitCode = 1;
  })
  .finally(disconnectRedis);
