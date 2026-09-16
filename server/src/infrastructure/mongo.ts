import mongoose, { type Mongoose } from 'mongoose';
import { config } from '../config/index.js';
import { logger } from './logger.js';

let connected = false;

export async function connectMongo(): Promise<Mongoose> {
  if (connected) return mongoose;
  mongoose.set('strictQuery', true);
  await mongoose.connect(config.mongoUri, {
    serverSelectionTimeoutMS: 8000,
    autoIndex: true,
  });
  connected = true;
  logger.info({ uri: redact(config.mongoUri) }, 'mongo connected');
  return mongoose;
}

export async function disconnectMongo(): Promise<void> {
  if (!connected) return;
  await mongoose.disconnect();
  connected = false;
}

function redact(uri: string): string {
  return uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@');
}
