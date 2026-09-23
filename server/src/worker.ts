import { connectMongo, disconnectMongo } from './infrastructure/mongo.js';
import { connectRedis, disconnectRedis } from './infrastructure/redis.js';
import { logger } from './infrastructure/logger.js';
import { startIdleSessionSweeper } from './services/idleSessionSweeper.js';
import { startAnomalyScheduler } from './services/anomalyService.js';
import { startBackgroundJobWorker } from './services/backgroundJobWorker.js';

async function main(): Promise<void> {
  await connectMongo();
  await connectRedis();
  const stopIdle = startIdleSessionSweeper();
  const stopAnomaly = startAnomalyScheduler();
  const stopBackgroundJobs = startBackgroundJobWorker();
  logger.info('background worker started');
  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'background worker shutting down');
    stopIdle();
    stopAnomaly();
    stopBackgroundJobs();
    await disconnectRedis();
    await disconnectMongo();
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main().catch((error) => {
  logger.error({ err: error }, 'background worker failed to start');
  process.exit(1);
});
