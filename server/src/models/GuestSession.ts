import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const guestSessionSchema = new Schema(
  {
    tableSessionId: { type: Schema.Types.ObjectId, ref: 'TableSession', required: true, index: true },
    participantId: { type: String, required: true },
    tokenHash: { type: String, required: true, unique: true },
    receiptTokenHash: { type: String, unique: true, sparse: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);
guestSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type GuestSessionDoc = HydratedDocument<InferSchemaType<typeof guestSessionSchema>>;
export const GuestSessionModel = model('GuestSession', guestSessionSchema);
