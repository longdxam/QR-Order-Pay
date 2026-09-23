import { logger } from './logger.js';
import { isRedisReady, redisCommandClient } from './redis.js';

export async function cachedJson<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
  if (isRedisReady()) {
    try {
      const cached = await redisCommandClient().get(key);
      if (cached) return JSON.parse(cached) as T;
    } catch (error) {
      logger.warn({ err: error, cacheKey: key }, 'cache read failed');
    }
  }

  const value = await loader();
  if (isRedisReady()) {
    try {
      await redisCommandClient().set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      logger.warn({ err: error, cacheKey: key }, 'cache write failed');
    }
  }
  return value;
}

export async function cacheGeneration(key: string): Promise<string> {
  if (!isRedisReady()) return 'local';
  try {
    return (await redisCommandClient().get(key)) ?? '0';
  } catch {
    return 'local';
  }
}

export async function incrementCacheGeneration(key: string): Promise<void> {
  if (!isRedisReady()) return;
  try {
    await redisCommandClient().incr(key);
  } catch (error) {
    logger.warn({ err: error, cacheKey: key }, 'cache invalidation failed');
  }
}
