import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const paymentSchema = new Schema(
  {
    tableSessionId: {
      type: Schema.Types.ObjectId,
      ref: 'TableSession',
      required: true,
      index: true,
    },
    shiftId: { type: Schema.Types.ObjectId, ref: 'CashShift', default: null, index: true },
    orderIds: { type: [Schema.Types.ObjectId], default: [] },
    amount: { type: Number, required: true, min: 0 },
    method: { type: String, enum: ['CASH', 'BANK_TRANSFER', 'OTHER'], default: 'CASH' },
    status: { type: String, enum: ['SUCCESS', 'REFUNDED'], default: 'SUCCESS' },
    confirmedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    paidAt: { type: Date, default: Date.now, index: true },
    idempotencyKey: { type: String, required: true, unique: true },
    note: { type: String, default: '' },
  },
  { timestamps: true },
);

export type PaymentDoc = HydratedDocument<InferSchemaType<typeof paymentSchema>>;
export const PaymentModel = model('Payment', paymentSchema);
