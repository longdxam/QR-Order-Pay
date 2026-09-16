import http from 'node:http';
import { buildApp } from './app.js';
import { config } from './config/index.js';
import { connectMongo, disconnectMongo } from './infrastructure/mongo.js';
import { logger } from './infrastructure/logger.js';
import { createSocketServer } from './realtime/socket.js';

async function main(): Promise<void> {
  await connectMongo();
  const app = buildApp();
  const httpServer = http.createServer(app);
  createSocketServer(httpServer);
  httpServer.listen(config.port, () => {
    logger.info({ port: config.port }, 'server listening');
  });
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    httpServer.close();
    await disconnectMongo();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main().catch((e) => {
  logger.error({ err: e }, 'failed to start');
  process.exit(1);
});
