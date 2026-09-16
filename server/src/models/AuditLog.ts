import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const auditLogSchema = new Schema(
  {
    actorType: { type: String, enum: ['USER', 'GUEST', 'SYSTEM'], required: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    participantId: { type: String, default: null },
    action: { type: String, required: true, index: true },
    entityType: { type: String, required: true },
    entityId: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ createdAt: -1 });

export type AuditLogDoc = HydratedDocument<InferSchemaType<typeof auditLogSchema>>;
export const AuditLogModel = model('AuditLog', auditLogSchema);
