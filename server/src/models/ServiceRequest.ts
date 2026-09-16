import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const serviceRequestSchema = new Schema(
  {
    tableSessionId: { type: Schema.Types.ObjectId, ref: 'TableSession', required: true, index: true },
    participantId: { type: String, required: true },
    type: { type: String, enum: ['CALL_STAFF', 'REQUEST_BILL', 'OTHER'], required: true },
    status: { type: String, enum: ['OPEN', 'RESOLVED'], default: 'OPEN', index: true },
    note: { type: String, default: '' },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export type ServiceRequestDoc = HydratedDocument<InferSchemaType<typeof serviceRequestSchema>>;
export const ServiceRequestModel = model('ServiceRequest', serviceRequestSchema);
