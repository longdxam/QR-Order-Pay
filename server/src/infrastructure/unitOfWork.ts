import type { ClientSession } from 'mongoose';
import mongoose from 'mongoose';

export interface UnitOfWork {
  withTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T>;
  session(): ClientSession | null;
}

class MongoUnitOfWork implements UnitOfWork {
  async withTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = await mongoose.startSession();
    try {
      let result!: T;
      await session.withTransaction(async () => {
        result = await work(session);
      });
      return result;
    } finally {
      await session.endSession();
    }
  }

  session(): ClientSession | null {
    return null;
  }
}

export const unitOfWork: UnitOfWork = new MongoUnitOfWork();
