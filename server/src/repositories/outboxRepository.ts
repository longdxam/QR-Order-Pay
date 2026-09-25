import { randomUUID } from 'node:crypto';
import type { ClientSession } from 'mongoose';
import { OutboxEventModel, type OutboxEventDoc } from '../models/OutboxEvent.js';
import type { RealtimeEvent, RealtimeTarget } from '../infrastructure/backgroundQueue.js';

export interface RealtimeOutboxInput {
  eventId?: string;
  eventType: RealtimeEvent;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion?: number | null;
  target: RealtimeTarget;
  payload: unknown;
}

export const outboxRepository = {
  async createRealtimeEvents(
    inputs: RealtimeOutboxInput[],
    session: ClientSession,
  ): Promise<OutboxEventDoc[]> {
    if (inputs.length === 0) return [];
    return OutboxEventModel.create(
      inputs.map((input) => ({
        eventId: input.eventId ?? randomUUID(),
        eventType: input.eventType,
        schemaVersion: 1,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        aggregateVersion: input.aggregateVersion ?? null,
        target: input.target,
        payload: input.payload,
      })),
      { session, ordered: true },
    );
  },

  async claimNext(owner: string, leaseMs: number): Promise<OutboxEventDoc | null> {
    const now = new Date();
    return OutboxEventModel.findOneAndUpdate(
      {
        $or: [
          { status: 'PENDING', nextAttemptAt: { $lte: now } },
          { status: 'PROCESSING', leaseUntil: { $lte: now } },
        ],
      },
      {
        $set: {
          status: 'PROCESSING',
          leaseOwner: owner,
          leaseUntil: new Date(now.getTime() + leaseMs),
        },
        $inc: { attempts: 1 },
      },
      { new: true, sort: { createdAt: 1 } },
    );
  },

  async markPublished(id: string, owner: string): Promise<boolean> {
    const result = await OutboxEventModel.updateOne(
      { _id: id, status: 'PROCESSING', leaseOwner: owner },
      {
        $set: { status: 'PUBLISHED', publishedAt: new Date(), lastError: '' },
        $unset: { leaseOwner: 1, leaseUntil: 1 },
      },
    );
    return result.modifiedCount === 1;
  },

  async retryOrFail(
    id: string,
    owner: string,
    attempts: number,
    maxAttempts: number,
    error: string,
    retryDelayMs: number,
  ): Promise<'PENDING' | 'FAILED'> {
    const status = attempts >= maxAttempts ? 'FAILED' : 'PENDING';
    await OutboxEventModel.updateOne(
      { _id: id, status: 'PROCESSING', leaseOwner: owner },
      {
        $set: {
          status,
          lastError: error.slice(0, 500),
          nextAttemptAt: new Date(Date.now() + retryDelayMs),
        },
        $unset: { leaseOwner: 1, leaseUntil: 1 },
      },
    );
    return status;
  },

  async statusCounts(): Promise<Record<string, number>> {
    const rows = await OutboxEventModel.aggregate<{ _id: string; count: number }>([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    return Object.fromEntries(rows.map((row) => [row._id, row.count]));
  },

  async listFailed(limit = 50): Promise<
    Array<{
      eventId: string;
      eventType: string;
      aggregateType: string;
      aggregateId: string;
      attempts: number;
      lastError: string;
      createdAt: Date;
    }>
  > {
    return OutboxEventModel.find({ status: 'FAILED' })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .select('eventId eventType aggregateType aggregateId attempts lastError createdAt')
      .lean();
  },

  async replayFailed(eventId: string): Promise<boolean> {
    const result = await OutboxEventModel.updateOne(
      { eventId, status: 'FAILED' },
      {
        $set: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lastError: '' },
        $unset: { leaseOwner: 1, leaseUntil: 1, publishedAt: 1 },
      },
    );
    return result.modifiedCount === 1;
  },
};
