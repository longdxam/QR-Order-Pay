import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const reviewSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, unique: true },
    tableSessionId: { type: Schema.Types.ObjectId, ref: 'TableSession', required: true, index: true },
    participantId: { type: String, required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: '' },
  },
  { timestamps: true },
);

export type ReviewDoc = HydratedDocument<InferSchemaType<typeof reviewSchema>>;
export const ReviewModel = model('Review', reviewSchema);
