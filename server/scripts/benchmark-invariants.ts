import mongoose from 'mongoose';
import { connectMongo, disconnectMongo } from '../src/infrastructure/mongo.js';
import { BillModel } from '../src/models/Bill.js';
import { GuestSessionModel } from '../src/models/GuestSession.js';
import { OrderModel } from '../src/models/Order.js';
import { PaymentModel } from '../src/models/Payment.js';
import { TableSessionModel } from '../src/models/TableSession.js';

async function main(): Promise<void> {
  await connectMongo();
  const databaseName = mongoose.connection.db?.databaseName ?? '';
  if (!databaseName.includes('benchmark'))
    throw new Error(`Refusing to inspect non-benchmark database: ${databaseName}`);

  const [
    orders,
    duplicateKeys,
    totalMismatch,
    invalidStatus,
    guests,
    participantIds,
    payments,
    bills,
    tableSessions,
    activeTableSessions,
  ] = await Promise.all([
    OrderModel.countDocuments(),
    OrderModel.aggregate<{ count: number }>([
      {
        $group: {
          _id: { tableSessionId: '$tableSessionId', idempotencyKey: '$idempotencyKey' },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
      { $count: 'count' },
    ]),
    OrderModel.aggregate<{ count: number }>([
      { $match: { $expr: { $ne: ['$total', { $sum: '$items.lineTotal' }] } } },
      { $count: 'count' },
    ]),
    OrderModel.countDocuments({
      status: { $nin: ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED', 'CANCELLED'] },
    }),
    GuestSessionModel.countDocuments(),
    GuestSessionModel.distinct('participantId'),
    PaymentModel.countDocuments(),
    BillModel.countDocuments(),
    TableSessionModel.countDocuments(),
    TableSessionModel.countDocuments({ status: { $in: ['OPEN', 'CHECKOUT'] } }),
  ]);

  const result = {
    orders,
    duplicateKeys: duplicateKeys[0]?.count ?? 0,
    totalMismatch: totalMismatch[0]?.count ?? 0,
    invalidStatus,
    guests,
    participants: participantIds.length,
    payments,
    bills,
    tableSessions,
    activeTableSessions,
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);

  if (
    result.duplicateKeys !== 0 ||
    result.totalMismatch !== 0 ||
    result.invalidStatus !== 0 ||
    result.activeTableSessions !== 1
  ) {
    process.exitCode = 1;
  }
  await disconnectMongo();
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
