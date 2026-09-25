import { Schema, model } from 'mongoose';

const migrationStateSchema = new Schema(
  {
    name: { type: String, required: true, unique: true },
    applied: { type: [{ id: String, appliedAt: Date, checksum: String, _id: false }], default: [] },
    lockOwner: { type: String, default: null },
    lockUntil: { type: Date, default: null },
  },
  { timestamps: true },
);
export const MigrationStateModel = model('MigrationState', migrationStateSchema);
