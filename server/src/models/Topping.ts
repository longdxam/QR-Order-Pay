import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const toppingSchema = new Schema(
  {
    name: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    isAvailable: { type: Boolean, default: true },
    isArchived: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export type ToppingDoc = HydratedDocument<InferSchemaType<typeof toppingSchema>>;
export const ToppingModel = model('Topping', toppingSchema);
