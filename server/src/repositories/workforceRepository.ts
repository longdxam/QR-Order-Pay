import { Types, type ClientSession } from 'mongoose';
import {
  StaffingPolicyModel,
  WorkActivityModel,
  WorkScheduleCopyModel,
  WorkShiftModel,
  type WorkShiftDoc,
} from '../models/WorkShift.js';

type Id = string | Types.ObjectId;
const NOT_CANCELLED = { $ne: 'CANCELLED' };

export const workShiftRepository = {
  async findById(id: string, session: ClientSession) {
    return WorkShiftModel.findById(id).session(session);
  },
  async findByRequestId(requestId: string, session?: ClientSession | null) {
    return WorkShiftModel.findOne({ requestId }).session(session ?? null);
  },
  async create(data: Record<string, unknown>, session: ClientSession): Promise<WorkShiftDoc> {
    const [shift] = await WorkShiftModel.create([data], { session });
    return shift!;
  },
  async save(shift: WorkShiftDoc, session: ClientSession): Promise<void> {
    await shift.save({ session });
  },
  /** Nhân viên đã có ca (chưa hủy) chồng thời gian [start, end), trừ ca `except`. */
  async hasScheduleOverlap(
    staffId: string,
    start: Date,
    end: Date,
    except: string | null,
    session: ClientSession,
  ): Promise<boolean> {
    const found = await WorkShiftModel.exists({
      staffId,
      status: NOT_CANCELLED,
      startsAt: { $lt: end },
      endsAt: { $gt: start },
      ...(except ? { _id: { $ne: except } } : {}),
    }).session(session);
    return !!found;
  },
  /** Giờ làm thực tế của ca khác chồng [start, end) hoặc còn ca chưa ra (end = null: mở). */
  async hasAttendanceOverlap(
    staffId: string,
    start: Date,
    end: Date | null,
    except: string,
    session: ClientSession,
  ): Promise<boolean> {
    const found = await WorkShiftModel.exists({
      staffId,
      _id: { $ne: except },
      effectiveInAt: { $ne: null, ...(end ? { $lt: end } : {}) },
      $or: [{ effectiveOutAt: null }, { effectiveOutAt: { $gt: start } }],
    }).session(session);
    return !!found;
  },
  /** Ca đang làm của nhân viên tại thời điểm `at`; tăng activityVersion để khóa ca trong transaction. */
  async touchWorkingShift(staffId: string, at: Date, session: ClientSession) {
    return WorkShiftModel.findOneAndUpdate(
      { staffId, status: 'WORKING', effectiveInAt: { $lte: at } },
      { $inc: { activityVersion: 1 } },
      { new: true, session },
    );
  },
  async listOverlapping(start: Date, end: Date, staffId: string | null) {
    return WorkShiftModel.find({
      ...(staffId ? { staffId: new Types.ObjectId(staffId) } : {}),
      startsAt: { $lt: end },
      endsAt: { $gt: start },
    }).sort({ startsAt: 1, staffId: 1 });
  },
  async findWorking(staffId: string) {
    return WorkShiftModel.findOne({ staffId, status: 'WORKING' });
  },
  async countWorking(staffIds: Id[], at: Date): Promise<number> {
    return WorkShiftModel.countDocuments({
      status: 'WORKING',
      staffId: { $in: staffIds },
      effectiveInAt: { $lte: at },
    });
  },
  /** Ca chưa hủy có lịch hoặc giờ làm thực tế giao với [start, end) — dùng cho bảng công tuần. */
  async listAttendance(start: Date, end: Date, staffId: string | null) {
    return WorkShiftModel.find({
      ...(staffId ? { staffId: new Types.ObjectId(staffId) } : {}),
      status: NOT_CANCELLED,
      $or: [
        { startsAt: { $lt: end }, endsAt: { $gt: start } },
        {
          effectiveInAt: { $ne: null, $lt: end },
          $or: [{ effectiveOutAt: null }, { effectiveOutAt: { $gt: start } }],
        },
      ],
    });
  },
  /** Ca chưa hủy bắt đầu trong [start, end), theo thứ tự tạo — nguồn sao chép lịch. */
  async listStartingBetween(start: Date, end: Date, session?: ClientSession | null) {
    return WorkShiftModel.find({ startsAt: { $gte: start, $lt: end }, status: NOT_CANCELLED })
      .sort({ _id: 1 })
      .session(session ?? null);
  },
  async listActiveForStaffBetween(
    staffIds: Id[],
    from: Date,
    until: Date,
    session?: ClientSession | null,
  ) {
    return WorkShiftModel.find({
      staffId: { $in: staffIds },
      status: NOT_CANCELLED,
      startsAt: { $lt: until },
      endsAt: { $gt: from },
    }).session(session ?? null);
  },
};

export interface ShiftActivityFacets {
  counts: Array<{ _id: { shift: Types.ObjectId; stage: string }; count: number }>;
  preparation: Array<{ _id: Types.ObjectId; count: number; avg: number }>;
  reviews: Array<{ _id: Types.ObjectId; count: number; avg: number }>;
}
export interface StaffStageCount {
  _id: { staffId: Types.ObjectId; stage: string };
  name: string;
  count: number;
  outside: number;
}
export interface StaffAverage {
  _id: Types.ObjectId;
  name: string;
  count: number;
  avg: number;
}

const reviewLookup = {
  $lookup: { from: 'reviews', localField: 'orderId', foreignField: 'orderId', as: 'review' },
};

export const workActivityRepository = {
  async findPreparation(orderId: string, session: ClientSession) {
    return WorkActivityModel.findOne({ orderId, stage: 'PREPARING' }).session(session);
  },
  async create(data: Record<string, unknown>, session: ClientSession): Promise<void> {
    await WorkActivityModel.create([data], { session });
  },
  /** Số công đoạn, thời gian pha và sao đánh giá theo từng ca. */
  async facetsByShift(ids: Types.ObjectId[]): Promise<ShiftActivityFacets | undefined> {
    const [result] = await WorkActivityModel.aggregate<ShiftActivityFacets>([
      { $match: { $or: [{ workShiftId: { $in: ids } }, { preparationShiftId: { $in: ids } }] } },
      {
        $facet: {
          counts: [
            { $match: { workShiftId: { $in: ids } } },
            { $group: { _id: { shift: '$workShiftId', stage: '$stage' }, count: { $sum: 1 } } },
          ],
          preparation: [
            { $match: { stage: 'READY', preparationShiftId: { $in: ids } } },
            {
              $group: {
                _id: '$preparationShiftId',
                count: { $sum: 1 },
                avg: { $avg: '$preparationMs' },
              },
            },
          ],
          reviews: [
            { $match: { stage: 'SERVED', workShiftId: { $in: ids } } },
            reviewLookup,
            { $unwind: '$review' },
            {
              $group: { _id: '$workShiftId', count: { $sum: 1 }, avg: { $avg: '$review.rating' } },
            },
          ],
        },
      },
    ]);
    return result;
  },
  async stageCountsByStaff(start: Date, end: Date, staffId: string | null) {
    const own = staffId ? { staffId: new Types.ObjectId(staffId) } : {};
    return WorkActivityModel.aggregate<StaffStageCount>([
      { $match: { at: { $gte: start, $lt: end }, ...own } },
      {
        $group: {
          _id: { staffId: '$staffId', stage: '$stage' },
          name: { $last: '$staffName' },
          count: { $sum: 1 },
          outside: { $sum: { $cond: [{ $eq: ['$workShiftId', null] }, 1, 0] } },
        },
      },
    ]);
  },
  /** Thời gian pha thuộc người pha, tính theo mốc READY. */
  async preparationByStaff(start: Date, end: Date, staffId: string | null) {
    return WorkActivityModel.aggregate<StaffAverage>([
      {
        $match: {
          at: { $gte: start, $lt: end },
          stage: 'READY',
          preparationStaffId: staffId ? new Types.ObjectId(staffId) : { $ne: null },
        },
      },
      {
        $group: {
          _id: '$preparationStaffId',
          name: { $last: '$preparationStaffName' },
          count: { $sum: 1 },
          avg: { $avg: '$preparationMs' },
        },
      },
    ]);
  },
  async reviewsByStaff(start: Date, end: Date, staffId: string | null) {
    const own = staffId ? { staffId: new Types.ObjectId(staffId) } : {};
    return WorkActivityModel.aggregate<StaffAverage>([
      { $match: { at: { $gte: start, $lt: end }, stage: 'SERVED', ...own } },
      reviewLookup,
      { $unwind: '$review' },
      {
        $group: {
          _id: '$staffId',
          name: { $last: '$staffName' },
          count: { $sum: 1 },
          avg: { $avg: '$review.rating' },
        },
      },
    ]);
  },
};

export const staffingPolicyRepository = {
  async findDefault(session: ClientSession) {
    return StaffingPolicyModel.findById('default').session(session);
  },
  async readDefault() {
    return StaffingPolicyModel.findById('default').lean();
  },
  newDefault() {
    return new StaffingPolicyModel({ _id: 'default' });
  },
  async save(policy: ReturnType<typeof StaffingPolicyModel.hydrate>, session: ClientSession) {
    await policy.save({ session });
  },
};

export const workScheduleCopyRepository = {
  async findById(requestId: string, session?: ClientSession | null) {
    return WorkScheduleCopyModel.findById(requestId).session(session ?? null);
  },
  async create(
    data: { _id: string; requestHash: string; createdBy: string; shiftIds: string[] },
    session: ClientSession,
  ): Promise<void> {
    await WorkScheduleCopyModel.create([data], { session });
  },
};
