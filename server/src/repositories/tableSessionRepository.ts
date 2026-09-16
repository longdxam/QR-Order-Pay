import type { ClientSession } from 'mongoose';
import { TableSessionModel, type TableSessionDoc } from '../models/TableSession.js';
import { ConflictError } from '../errors/AppError.js';

export interface ITableSessionRepository {
  findActiveByTable(tableId: string): Promise<TableSessionDoc | null>;
  findById(id: string, session?: ClientSession | null): Promise<TableSessionDoc | null>;
  create(data: { tableId: string; openedBy?: string | null }, session?: ClientSession | null): Promise<TableSessionDoc>;
  updateStatus(
    id: string,
    expectedVersion: number,
    update: { status: 'OPEN' | 'CHECKOUT' | 'CLOSED'; closedBy?: string | null },
    session?: ClientSession | null,
  ): Promise<TableSessionDoc | null>;
  listOpen(): Promise<TableSessionDoc[]>;
}

export const tableSessionRepository: ITableSessionRepository = {
  async findActiveByTable(tableId) {
    return TableSessionModel.findOne({ tableId, status: { $in: ['OPEN', 'CHECKOUT'] } });
  },
  async findById(id, session) {
    return TableSessionModel.findById(id, null, { session: session ?? undefined });
  },
  async create(data, session) {
    try {
      return await TableSessionModel.create(
        [{ tableId: data.tableId, openedBy: data.openedBy ?? null }],
        { session: session ?? undefined },
      ).then((d) => d[0]!);
    } catch (e: unknown) {
      const err = e as { code?: number };
      if (err.code === 11000) {
        throw new ConflictError(
          'TABLE_SESSION_ALREADY_OPEN',
          'Bàn này đang có phiên phục vụ, hãy đóng phiên cũ trước.',
        );
      }
      throw e;
    }
  },
  async updateStatus(id, expectedVersion, update, session) {
    const r = await TableSessionModel.findOneAndUpdate(
      { _id: id, version: expectedVersion },
      {
        $set: {
          status: update.status,
          ...(update.status === 'CLOSED' ? { closedAt: new Date(), closedBy: update.closedBy ?? null } : {}),
        },
        $inc: { version: 1 },
      },
      { new: true, session: session ?? undefined },
    );
    return r;
  },
  async listOpen() {
    return TableSessionModel.find({ status: { $in: ['OPEN', 'CHECKOUT'] } });
  },
};
