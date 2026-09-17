import type { ClientSession } from 'mongoose';
import mongoose from 'mongoose';
import { PaymentModel } from '../models/Payment.js';

export const paymentRepository = {
  async create(data: Record<string, unknown>, session?: ClientSession | null) {
    const [doc] = await PaymentModel.create([data], { session: session ?? undefined });
    if (!doc) throw new Error('Failed to create payment');
    return doc;
  },
  async findByIdempotency(key: string) {
    return PaymentModel.findOne({ idempotencyKey: key });
  },
  async listBySession(tableSessionId: string, session?: ClientSession | null) {
    return PaymentModel.find({ tableSessionId }, null, { session: session ?? undefined }).sort({ paidAt: -1 });
  },
  async sumPaidBySession(tableSessionId: string): Promise<number> {
    const agg = await PaymentModel.aggregate([
      { $match: { tableSessionId: new mongoose.Types.ObjectId(tableSessionId), status: 'SUCCESS' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    return agg[0]?.total ?? 0;
  },
};
