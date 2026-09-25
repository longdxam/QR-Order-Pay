import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

const realtimeTargetSchema = new Schema(
  {
    scope: { type: String, enum: ['all', 'staff', 'session', 'guest'], required: true },
    tableSessionId: { type: String, default: null },
    participantId: { type: String, default: null },
  },
  { _id: false },
);

export const outboxEventSchema = new Schema(
  {
    eventId: { type: String, required: true, unique: true },
    eventType: { type: String, required: true },
    schemaVersion: { type: Number, required: true, default: 1, min: 1 },
    aggregateType: { type: String, required: true },
    aggregateId: { type: String, required: true },
    aggregateVersion: { type: Number, default: null },
    target: { type: realtimeTargetSchema, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: ['PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED'],
      default: 'PENDING',
      required: true,
    },
    attempts: { type: Number, default: 0, min: 0 },
    nextAttemptAt: { type: Date, default: Date.now },
    leaseOwner: { type: String, default: null },
    leaseUntil: { type: Date, default: null },
    publishedAt: { type: Date, default: null },
    lastError: { type: String, default: '' },
  },
  { timestamps: true },
);

outboxEventSchema.index(
  { status: 1, nextAttemptAt: 1, leaseUntil: 1, createdAt: 1 },
  { name: 'outbox_due' },
);
outboxEventSchema.index({ aggregateType: 1, aggregateId: 1, createdAt: 1 });

export type OutboxEventDoc = HydratedDocument<InferSchemaType<typeof outboxEventSchema>>;
export const OutboxEventModel = model('OutboxEvent', outboxEventSchema);
