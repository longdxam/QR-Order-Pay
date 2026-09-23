import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

const explanationSchema = new Schema({
  mode: { type: String, enum: ['llm', 'fallback'], required: true },
  summary: { type: String, required: true },
  evidence: { type: [String], default: [] },
  hypotheses: { type: [String], default: [] },
  checks: { type: [String], default: [] },
}, { _id: false });

export const anomalyAlertSchema = new Schema({
  bucketKey: { type: String, required: true, unique: true },
  detector: { type: String, enum: ['HTTP_ERROR_RATE', 'HTTP_LATENCY_P95', 'PREPARATION_P95', 'CANCELLATION_RATE'], required: true, index: true },
  target: { type: String, required: true },
  status: { type: String, enum: ['OPEN', 'ACKNOWLEDGED', 'CLOSED'], default: 'OPEN', required: true, index: true },
  severity: { type: String, enum: ['INFO', 'WARNING', 'CRITICAL'], required: true },
  windowStart: { type: Date, required: true },
  windowEnd: { type: Date, required: true },
  observedValue: { type: Number, required: true },
  thresholdValue: { type: Number, required: true },
  baselineValue: { type: Number, default: null },
  sampleCount: { type: Number, required: true },
  baselineSampleCount: { type: Number, required: true },
  method: { type: String, required: true },
  evidence: { type: Schema.Types.Mixed, required: true },
  explanation: { type: explanationSchema, required: true },
  firstDetectedAt: { type: Date, required: true },
  lastDetectedAt: { type: Date, required: true },
  acknowledgedAt: { type: Date, default: null },
  acknowledgedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  closedAt: { type: Date, default: null },
  closedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

anomalyAlertSchema.index({ detector: 1, target: 1, lastDetectedAt: -1 });
anomalyAlertSchema.index({ status: 1, lastDetectedAt: -1 });

export type AnomalyAlertDoc = HydratedDocument<InferSchemaType<typeof anomalyAlertSchema>>;
export const AnomalyAlertModel = model('AnomalyAlert', anomalyAlertSchema);
