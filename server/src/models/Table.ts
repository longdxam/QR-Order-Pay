import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const tableSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    capacity: { type: Number, required: true, min: 1 },
    publicTokenHash: { type: String, required: true, unique: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export type TableDoc = HydratedDocument<InferSchemaType<typeof tableSchema>>;
export const TableModel = model('Table', tableSchema);
