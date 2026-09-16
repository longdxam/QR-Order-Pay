import mongoose from 'mongoose';
import { config } from '../src/config/index.js';

const MAX_TRIES = 30;

async function wait(): Promise<void> {
  for (let i = 0; i < MAX_TRIES; i++) {
    try {
      await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 3000 });
      // eslint-disable-next-line no-console
      console.log(`MongoDB reachable at ${config.mongoUri}`);
      await mongoose.disconnect();
      process.exit(0);
    } catch (e) {
      const err = e as Error;
      // eslint-disable-next-line no-console
      console.log(`[${i + 1}/${MAX_TRIES}] waiting for mongo: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  process.exit(1);
}

void wait();
