import { io, type Socket } from 'socket.io-client';
import { connectMongo, disconnectMongo } from '../src/infrastructure/mongo.js';
import { GuestSessionModel } from '../src/models/GuestSession.js';
import { OrderModel } from '../src/models/Order.js';
import { ProductModel } from '../src/models/Product.js';
import { TableModel } from '../src/models/Table.js';
import { TableSessionModel } from '../src/models/TableSession.js';
import { sha256 } from '../src/utils/crypto.js';

const serverA = process.env.SERVER_A_URL ?? 'http://server-a:4000';
const serverB = process.env.SERVER_B_URL ?? 'http://server-b:4000';
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const token = `multi-instance-${suffix}`;
const participantId = `participant-${suffix}`;
let socket: Socket | null = null;
let tableId = '';
let tableSessionId = '';

async function main(): Promise<void> {
  await connectMongo();
  try {
    const product = await ProductModel.findOne({ isAvailable: true, isArchived: false });
    if (!product) throw new Error('No available product for multi-instance smoke test');
    const table = await TableModel.create({
      code: `MI-${suffix}`,
      name: 'Multi-instance smoke test',
      capacity: 2,
      publicTokenHash: sha256(token),
      isActive: true,
    });
    tableId = table.id;
    const tableSession = await TableSessionModel.create({ tableId: table._id, status: 'OPEN', source: 'GUEST', version: 0 });
    tableSessionId = tableSession.id;
    await GuestSessionModel.create({
      tableSessionId: tableSession._id,
      participantId,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });

    socket = io(serverA, {
      transports: ['websocket'],
      auth: { role: 'GUEST' },
      extraHeaders: { Cookie: `mc_guest=${token}` },
      reconnection: false,
    });
    await once(socket, 'connect');
    const orderEvent = once(socket, 'order.created');
    const orderResponse = await fetch(`${serverB}/api/v1/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `mc_guest=${token}`, 'idempotency-key': `smoke-${suffix}` },
      body: JSON.stringify({
        items: [{
          productId: product.id,
          variantId: product.variants[0]?._id?.toString() ?? null,
          sugarLevel: product.allowedOptions.sugarLevels[0] ?? '',
          iceLevel: product.allowedOptions.iceLevels[0] ?? '',
          toppingIds: [],
          quantity: 1,
        }],
      }),
    });
    if (orderResponse.status !== 201) throw new Error(`Cross-instance order failed: HTTP ${orderResponse.status}`);
    await orderEvent;

    const disconnected = once(socket, 'disconnect');
    const leaveResponse = await fetch(`${serverB}/api/v1/table-sessions/leave`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `mc_guest=${token}` },
      body: '{}',
    });
    if (leaveResponse.status !== 200) throw new Error(`Remote revocation failed: HTTP ${leaveResponse.status}`);
    await disconnected;
    process.stdout.write(JSON.stringify({ crossInstanceEvent: true, remoteRevocation: true, source: 'server-b', socketHost: 'server-a' }) + '\n');
  } finally {
    socket?.disconnect();
    if (tableSessionId) {
      await Promise.all([
        OrderModel.deleteMany({ tableSessionId }),
        GuestSessionModel.deleteMany({ tableSessionId }),
        TableSessionModel.deleteMany({ _id: tableSessionId }),
      ]);
    }
    if (tableId) await TableModel.deleteMany({ _id: tableId });
    await disconnectMongo();
  }
}

function once(client: Socket, event: string, timeoutMs = 8_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), timeoutMs);
    client.once(event, (value) => {
      clearTimeout(timeout);
      resolve(value);
    });
    client.once('connect_error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
