import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const tableSessionSchema = new Schema(
  {
    tableId: { type: Schema.Types.ObjectId, ref: 'Table', required: true, index: true },
    status: { type: String, enum: ['OPEN', 'CHECKOUT', 'CLOSED'], default: 'OPEN', required: true },
    startedAt: { type: Date, default: Date.now, required: true },
    closedAt: { type: Date, default: null },
    openedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    closedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    version: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// only one OPEN/CHECKOUT session per table
tableSessionSchema.index(
  { tableId: 1 },
  {
    name: 'one_active_session_per_table',
    unique: true,
    partialFilterExpression: { status: { $in: ['OPEN', 'CHECKOUT'] } },
  },
);

export type TableSessionDoc = HydratedDocument<InferSchemaType<typeof tableSessionSchema>>;
export const TableSessionModel = model('TableSession', tableSessionSchema);
