import type { ClientSession } from 'mongoose';
import { CashShiftModel, type CashShiftDoc } from '../models/CashShift.js';

export const cashShiftRepository = {
  /**
   * Ca thu ngân mở/đóng trong [start, end) hoặc đang mở (tối đa 50, ca mở trước), tổng số khớp bộ
   * lọc và tổng chênh lệch của các ca đã đóng trong khoảng.
   */
  async summarizeWindow(start: Date, end: Date) {
    const filter = {
      $or: [
        { openedAt: { $gte: start, $lt: end } },
        { closedAt: { $gte: start, $lt: end } },
        { status: 'OPEN' },
      ],
    };
    const [items, total, summary] = await Promise.all([
      CashShiftModel.find(filter).sort({ status: -1, openedAt: -1 }).limit(50).lean(),
      CashShiftModel.countDocuments(filter),
      CashShiftModel.aggregate<{ count: number; difference: number }>([
        { $match: { status: 'CLOSED', closedAt: { $gte: start, $lt: end } } },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            difference: { $sum: { $ifNull: ['$difference', 0] } },
          },
        },
      ]),
    ]);
    return { items, total, summary: summary[0] };
  },
  /** Tăng version của ca thu ngân đang mở để thao tác tiền phải xếp hàng với việc đóng ca. */
  async lockOpen(session: ClientSession): Promise<void> {
    await CashShiftModel.updateOne({ status: 'OPEN' }, { $inc: { version: 1 } }, { session });
  },
  /** Ca đang mở, tăng version để khóa trong transaction (gán khoản thu vào ca). */
  async lockOpenShift(session: ClientSession) {
    return CashShiftModel.findOneAndUpdate(
      { status: 'OPEN' },
      { $inc: { version: 1 } },
      { new: true, session },
    );
  },
  async findOpen(session: ClientSession) {
    return CashShiftModel.findOne({ status: 'OPEN' }).session(session);
  },
  async readOpen() {
    return CashShiftModel.findOne({ status: 'OPEN' }).lean();
  },
  async findById(id: unknown, session: ClientSession) {
    return CashShiftModel.findById(id).session(session);
  },
  async create(
    data: { code: string; openedBy: string; openedByName: string; openingCash: number },
    session: ClientSession,
  ): Promise<CashShiftDoc | undefined> {
    const [shift] = await CashShiftModel.create([data], { session });
    return shift;
  },
  /** Chốt ca đang mở nếu đúng version; chênh lệch = tiền đếm - tiền kỳ vọng. */
  async close(
    id: string,
    expectedVersion: number,
    result: {
      closedBy: string;
      closedByName: string;
      countedCash: number;
      expectedCash: number;
      reconciliationNote: string;
    },
    session: ClientSession,
  ) {
    return CashShiftModel.findOneAndUpdate(
      { _id: id, status: 'OPEN', version: expectedVersion },
      {
        $set: {
          status: 'CLOSED',
          closedBy: result.closedBy,
          closedByName: result.closedByName,
          closedAt: new Date(),
          countedCash: result.countedCash,
          expectedCash: result.expectedCash,
          difference: result.countedCash - result.expectedCash,
          reconciliationNote: result.reconciliationNote,
        },
        $inc: { version: 1 },
      },
      { new: true, session },
    );
  },
  async page(page: number, limit: number) {
    return Promise.all([
      CashShiftModel.find()
        .sort({ openedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      CashShiftModel.countDocuments(),
    ]);
  },
};
