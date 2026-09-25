import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

export const cancelRequestSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    tableSessionId: {
      type: Schema.Types.ObjectId,
      ref: 'TableSession',
      required: true,
      index: true,
    },
    participantId: { type: String, required: true },
    reason: { type: String, required: true, maxlength: 280 },
    status: {
      type: String,
      enum: ['REQUESTED', 'APPROVED', 'REJECTED'],
      default: 'REQUESTED',
      required: true,
    },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, default: '', maxlength: 280 },
    version: { type: Number, default: 0 },
  },
  { timestamps: true },
);
cancelRequestSchema.index(
  { orderId: 1 },
  {
    name: 'one_open_cancel_request_per_order',
    unique: true,
    partialFilterExpression: { status: 'REQUESTED' },
  },
);
cancelRequestSchema.index({ status: 1, createdAt: 1 });
export type CancelRequestDoc = HydratedDocument<InferSchemaType<typeof cancelRequestSchema>>;
export const CancelRequestModel = model('CancelRequest', cancelRequestSchema);
