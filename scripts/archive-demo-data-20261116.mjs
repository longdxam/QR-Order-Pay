// Maintenance for the exact demo records identified by the project owner on 16/11/2026.
// Preview by default; apply requires a full mongodump file. Restore is transactional too.
import mongoose from 'mongoose';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

const batchId = 'demo-cleanup-20261116-v1';
const apply = process.argv.includes('--apply');
const restore = process.argv.includes('--restore');
if (apply && restore) throw new Error('Choose apply or restore, not both.');
const reviews = new Map([
  ['6ab33b748bb2c5664226e06c', [5, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaa']],
  ['6ab33e258bb2c5664226e3c6', [5, 'ádasd']],
  ['6ab33e268bb2c5664226e3d2', [5, 'adada']],
  ['6ab5e6444bfc4ea68af298c1', [5, 'áesjadhjasdjhasgdasdasdasdad']],
  ['6acdd8e15fff64d975cb08a8', [5, 'nhu biu']],
  ['6acdde8fe7a55169c349b0f1', [5, 'tot']],
  ['6ace561c70d13a01b5a6d2f3', [5, 'ádasd']],
  ['6ad04a448b62967e881c9e32', [3, 'Ngon vl']],
  ['6ad1c1a43a33594a44f55d6b', [1, 'Uong ko ra j']],
  ['6ad1ca41169340e4c897224b', [5, 'Tiwjs']],
]);
const tableId = new mongoose.Types.ObjectId('b042cd8694dae069e341c4a0');
const productId = new mongoose.Types.ObjectId('9b5af47c78c1b0aba4fbb6ad');
const stringify = (value) => mongoose.mongo.BSON.EJSON.stringify(value, { relaxed: false });
const sha = (value) => createHash('sha256').update(value).digest('hex');
const hashDocs = (docs) => sha(stringify(docs));
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false });
try {
  const db = mongoose.connection.db;
  assert(db.databaseName === 'maycafe', 'Expected the local project database maycafe.');
  const archive = db.collection('demoDataArchives');
  const batches = db.collection('demoCleanupBatches');
  const existing = await batches.findOne({ _id: batchId });
  if (existing?.status === 'ARCHIVED' && !restore) {
    console.log(
      JSON.stringify({
        mode: apply ? 'apply' : 'preview',
        batchId,
        alreadyArchived: true,
        writes: 0,
      }),
    );
  } else if (restore) {
    assert(existing?.status === 'ARCHIVED', 'No archived batch available to restore.');
    const rows = await archive.find({ batchId }).toArray();
    assert(rows.length === existing.count, 'Archive count differs from manifest.');
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        for (const row of rows) {
          assert(hashDocs([row.document]) === row.sha256, 'Archive checksum mismatch.');
          assert(
            !(await db.collection(row.collection).findOne({ _id: row.document._id }, { session })),
            'Source ID already exists; refusing overwrite.',
          );
          await db.collection(row.collection).insertOne(row.document, { session });
        }
        await batches.updateOne(
          { _id: batchId, status: 'ARCHIVED' },
          { $set: { status: 'RESTORED', restoredAt: new Date() } },
          { session },
        );
        await db.collection('auditlogs').insertOne(
          {
            actorType: 'SYSTEM',
            action: 'demo.cleanupRestored',
            entityType: 'DemoDataset',
            entityId: batchId,
            metadata: { count: rows.length },
            createdAt: new Date(),
          },
          { session },
        );
      });
      console.log(JSON.stringify({ mode: 'restore', batchId, restored: rows.length }));
    } finally {
      await session.endSession();
    }
  } else {
    assert(!existing, 'A previous restored batch exists; review before creating another batch.');
    const plan = new Map();
    const read = async (name, filter) =>
      db.collection(name).find(filter).sort({ _id: 1 }).toArray();
    plan.set(
      'reviews',
      await read('reviews', {
        _id: { $in: [...reviews.keys()].map((id) => new mongoose.Types.ObjectId(id)) },
      }),
    );
    assert(
      plan.get('reviews').length === 10,
      'Expected exactly the ten owner-identified test reviews.',
    );
    for (const review of plan.get('reviews')) {
      const expected = reviews.get(String(review._id));
      assert(
        review.rating === expected[0] && review.comment === expected[1],
        'Review content changed; refusing a heuristic deletion.',
      );
    }
    plan.set('tables', await read('tables', { _id: tableId, code: 'DEMO-WF11', isActive: false }));
    plan.set(
      'products',
      await read('products', {
        _id: productId,
        slug: 'demo-workforce-history-v1',
        basePrice: 0,
        isArchived: true,
        isAvailable: false,
      }),
    );
    assert(
      plan.get('tables').length === 1 && plan.get('products').length === 1,
      'Demo catalog identity/status differs.',
    );
    const orders = await read('orders', {
      $or: [
        { tableId },
        { 'items.productId': productId },
        { code: { $in: ['D11-20261019-01', 'D11-20261019-02'] } },
      ],
    });
    assert(orders.length === 2, 'Unexpected references to the demo table/product.');
    for (const order of orders) {
      assert(
        ['D11-20261019-01', 'D11-20261019-02'].includes(order.code) &&
          String(order.tableId) === String(tableId) &&
          order.status === 'SERVED' &&
          order.paymentStatus === 'PAID' &&
          order.total === 0 &&
          (order.paidAmount ?? 0) === 0 &&
          order.items.length === 1 &&
          String(order.items[0].productId) === String(productId) &&
          order.items[0].lineTotal === 0,
        'Demo order differs or has monetary value.',
      );
    }
    const orderIds = orders.map((order) => order._id),
      sessionIds = orders.map((order) => order.tableSessionId);
    plan.set('orders', orders);
    plan.set(
      'tablesessions',
      await read('tablesessions', { $or: [{ tableId }, { _id: { $in: sessionIds } }] }),
    );
    assert(
      plan.get('tablesessions').length === 2 &&
        plan.get('tablesessions').every((row) => row.status === 'CLOSED'),
      'Demo has active/unexpected sessions.',
    );
    plan.set(
      'payments',
      await read('payments', {
        $or: [{ orderIds: { $in: orderIds } }, { tableSessionId: { $in: sessionIds } }],
      }),
    );
    assert(
      plan.get('payments').length === 2 &&
        plan
          .get('payments')
          .every(
            (row) =>
              row.amount === 0 &&
              row.method === 'OTHER' &&
              row.status === 'SUCCESS' &&
              row.orderIds.length === 1 &&
              orderIds.some((id) => id.equals(row.orderIds[0])),
          ),
      'Demo payment has money or unrelated references.',
    );
    plan.set(
      'bills',
      await read('bills', { $or: [{ tableId }, { tableSessionId: { $in: sessionIds } }] }),
    );
    assert(
      plan.get('bills').length === 2 &&
        plan
          .get('bills')
          .every(
            (row) =>
              /^DEMO-WF11-20261019-0[12]$/.test(row.invoiceCode) &&
              row.total === 0 &&
              row.paidAmount === 0,
          ),
      'Demo bill differs or has monetary value.',
    );

    const manifest = Object.fromEntries(
      [...plan].map(([name, docs]) => [
        name,
        { count: docs.length, ids: docs.map((doc) => String(doc._id)), sha256: hashDocs(docs) },
      ]),
    );
    const identifiers = new Set(
      [...plan.values()].flatMap((docs) => docs.map((doc) => String(doc._id))),
    );
    const containsReference = (value) => {
      if (value == null || value instanceof Date) return false;
      if (value instanceof mongoose.Types.ObjectId) return identifiers.has(String(value));
      if (Array.isArray(value)) return value.some(containsReference);
      if (typeof value === 'object') return Object.values(value).some(containsReference);
      return typeof value === 'string' && identifiers.has(value);
    };
    const preserved = new Map();
    for (const { name } of await db.listCollections().toArray()) {
      if (
        ['auditlogs', 'demoDataArchives', 'demoCleanupBatches'].includes(name) ||
        name.startsWith('system.')
      )
        continue;
      const docs = await read(name, {});
      const kept = docs.filter((doc) => !plan.get(name)?.some((row) => row._id.equals(doc._id)));
      assert(
        !kept.some(containsReference),
        `External reference to demo records in ${name}; archive refused.`,
      );
      preserved.set(name, { ids: kept.map((doc) => doc._id), hash: hashDocs(kept) });
    }
    const report = {
      mode: apply ? 'apply' : 'preview',
      batchId,
      manifest,
      count: [...plan.values()].reduce((sum, docs) => sum + docs.length, 0),
      moneyArchived: 0,
    };
    if (apply) {
      const backupPath = process.argv.find((arg) => arg.startsWith('--backup='))?.slice(9);
      assert(backupPath, 'Apply requires --backup=/path/to/full-mongodump.archive.gz');
      const backup = await fs.readFile(backupPath);
      assert(
        backup.length > 1000 && backup[0] === 0x1f && backup[1] === 0x8b,
        'Backup is missing or not a gzip mongodump.',
      );
      report.backupSha256 = sha(backup);
      for (const name of ['demoDataArchives', 'demoCleanupBatches']) {
        if (!(await db.listCollections({ name }).toArray()).length) await db.createCollection(name);
      }
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          for (const [name, docs] of plan) {
            const current = await db
              .collection(name)
              .find({ _id: { $in: docs.map((doc) => doc._id) } }, { session })
              .sort({ _id: 1 })
              .toArray();
            assert(
              hashDocs(current) === manifest[name].sha256,
              `Source ${name} changed since preview.`,
            );
            for (const doc of docs)
              await archive.insertOne(
                {
                  _id: `${batchId}:${name}:${doc._id}`,
                  batchId,
                  collection: name,
                  originalId: doc._id,
                  document: doc,
                  sha256: hashDocs([doc]),
                  archivedAt: new Date(),
                  reason:
                    'Owner identified these as test reviews and the zero-value workforce demo dataset; excluded from live presentation, originals retained.',
                },
                { session },
              );
            const deleted = await db
              .collection(name)
              .deleteMany({ _id: { $in: docs.map((doc) => doc._id) } }, { session });
            assert(deleted.deletedCount === docs.length, 'Archive/delete count mismatch.');
          }
          await batches.insertOne(
            {
              _id: batchId,
              status: 'ARCHIVED',
              createdAt: new Date(),
              count: report.count,
              backupSha256: report.backupSha256,
              manifest,
            },
            { session },
          );
          await db.collection('auditlogs').insertOne(
            {
              actorType: 'SYSTEM',
              action: 'demo.cleanupArchived',
              entityType: 'DemoDataset',
              entityId: batchId,
              metadata: {
                count: report.count,
                moneyArchived: 0,
                manifest,
                backupSha256: report.backupSha256,
              },
              createdAt: new Date(),
            },
            { session },
          );
        });
      } finally {
        await session.endSession();
      }
      for (const [name, before] of preserved) {
        const current = await read(name, { _id: { $in: before.ids } });
        assert(
          hashDocs(current) === before.hash,
          `Non-demo ${name} changed; inspect the full backup.`,
        );
      }
      report.preservedCollections = preserved.size;
    }
    console.log(JSON.stringify(report, null, 2));
  }
} finally {
  await mongoose.disconnect();
}
