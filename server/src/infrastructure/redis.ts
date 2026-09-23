import Redis from 'ioredis';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { config } from '../config/index.js';
import { logger } from './logger.js';
import { setDependencyReadiness } from './metrics.js';

let commandClient: Redis | null = null;
let publisher: Redis | null = null;
let subscriber: Redis | null = null;

export async function connectRedis(): Promise<void> {
  if (commandClient) return;
  commandClient = client('command');
  publisher = client('socket-publisher');
  subscriber = client('socket-subscriber');
  await Promise.all([commandClient.connect(), publisher.connect(), subscriber.connect()]);
  setDependencyReadiness('redis', true);
}

export async function disconnectRedis(): Promise<void> {
  const clients = [commandClient, publisher, subscriber].filter((value): value is Redis => value !== null);
  commandClient = null;
  publisher = null;
  subscriber = null;
  await Promise.all(clients.map(async (value) => {
    try { await value.quit(); } catch { value.disconnect(); }
  }));
  setDependencyReadiness('redis', false);
}

export function socketRedisClients(): { publisher: Redis; subscriber: Redis } | null {
  return publisher && subscriber ? { publisher, subscriber } : null;
}

export function createRateLimitStore(prefix: string): RedisStore {
  return new RedisStore({
    prefix: `maycafe:${prefix}:`,
    sendCommand: (command: string, ...args: string[]) => {
      if (!commandClient || commandClient.status !== 'ready') throw new Error('Redis rate-limit store unavailable');
      return commandClient.call(command, ...args) as Promise<RedisReply>;
    },
  });
}

export function isRedisReady(): boolean {
  return commandClient?.status === 'ready';
}

export function redisCommandClient(): Redis {
  if (!commandClient) throw new Error('Redis is not connected');
  return commandClient;
}

function client(role: string): Redis {
  const value = new Redis(config.redisUrl, { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1 });
  value.on('ready', () => setDependencyReadiness('redis', true));
  value.on('close', () => setDependencyReadiness('redis', false));
  value.on('error', (error) => logger.warn({ err: error.message, redisRole: role }, 'redis connection degraded'));
  return value;
}
