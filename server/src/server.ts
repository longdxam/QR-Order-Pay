import http from 'node:http';
import { buildApp } from './app.js';
import { config } from './config/index.js';
import { connectMongo, disconnectMongo } from './infrastructure/mongo.js';
import { logger } from './infrastructure/logger.js';
import { createSocketServer } from './realtime/socket.js';
import { closeHttpServer } from './infrastructure/lifecycle.js';
import { connectRedis, disconnectRedis } from './infrastructure/redis.js';
import { setSharedHttpObservationSink } from './infrastructure/metrics.js';
import { recordSharedHttpObservation } from './infrastructure/sharedHttpMetrics.js';

async function main(): Promise<void> {
  await connectMongo();
  await connectRedis();
  setSharedHttpObservationSink(recordSharedHttpObservation);
  const app = buildApp();
  const httpServer = http.createServer(app);
  createSocketServer(httpServer);
  httpServer.listen(config.port, () => {
    logger.info({ port: config.port }, 'server listening');
  });
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    let exitCode = 0;
    try {
      const { forced } = await closeHttpServer(httpServer, config.shutdownTimeoutMs);
      if (forced) logger.warn({ timeoutMs: config.shutdownTimeoutMs }, 'forced remaining HTTP connections closed');
    } catch (error) {
      exitCode = 1;
      logger.error({ err: error }, 'HTTP shutdown failed');
    }
    try {
      setSharedHttpObservationSink(null);
      await disconnectRedis();
    } catch (error) {
      exitCode = 1;
      logger.error({ err: error }, 'Redis shutdown failed');
    }
    try {
      await disconnectMongo();
    } catch (error) {
      exitCode = 1;
      logger.error({ err: error }, 'MongoDB shutdown failed');
    }
    process.exitCode = exitCode;
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main().catch((e) => {
  logger.error({ err: e }, 'failed to start');
  process.exit(1);
});
