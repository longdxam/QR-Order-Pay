import mongoose, { type Mongoose } from 'mongoose';
import { config } from '../config/index.js';
import { logger } from './logger.js';
import { setDependencyReadiness } from './metrics.js';

let connected = false;

export async function connectMongo(): Promise<Mongoose> {
  if (connected && mongoose.connection.readyState === 1) return mongoose;
  connected = false;
  mongoose.set('strictQuery', true);
  await mongoose.connect(config.mongoUri, {
    serverSelectionTimeoutMS: 8000,
    autoIndex: true,
  });
  connected = true;
  setDependencyReadiness('mongodb', true);
  logger.info({ uri: redact(config.mongoUri) }, 'mongo connected');
  return mongoose;
}

export async function disconnectMongo(): Promise<void> {
  if (!connected) return;
  await mongoose.disconnect();
  connected = false;
  setDependencyReadiness('mongodb', false);
}

export async function checkMongoReadiness(timeoutMs = 1_000): Promise<boolean> {
  if (!connected || mongoose.connection.readyState !== 1 || !mongoose.connection.db) return false;

  let timeout: NodeJS.Timeout | undefined;
  try {
    const ping = mongoose.connection.db.admin().ping().then(() => true);
    const expired = new Promise<boolean>((resolve) => {
      timeout = setTimeout(() => resolve(false), timeoutMs);
      timeout.unref();
    });
    return await Promise.race([ping, expired]);
  } catch {
    return false;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function redact(uri: string): string {
  return uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@');
}
