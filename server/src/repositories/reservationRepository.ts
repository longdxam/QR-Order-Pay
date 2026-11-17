import type { ClientSession } from 'mongoose';
import { ReservationModel, type ReservationDoc } from '../models/Reservation.js';

/** Lịch còn giữ bàn: đã xác nhận và chưa quá hạn đến, hoặc khách đã check-in. */
export function liveReservationFilter(now = new Date()) {
  return {
    $or: [{ status: 'CONFIRMED', arrivalDeadline: { $gt: now } }, { status: 'CHECKED_IN' }],
  };
}

export const reservationRepository = {
  /** Bàn có lịch còn hiệu lực giao với [start, end), trừ lịch `exceptId`. */
  async hasLiveOverlap(
    tableId: unknown,
    start: Date,
    end: Date,
    session: ClientSession,
    exceptId?: unknown,
    now?: Date,
  ): Promise<boolean> {
    return !!(await ReservationModel.exists({
      ...(exceptId !== undefined ? { _id: { $ne: exceptId } } : {}),
      tableId,
      ...liveReservationFilter(now),
      startsAt: { $lt: end },
      endsAt: { $gt: start },
    }).session(session));
  },
  /** Hoàn tất lịch đã check-in của phiên (khi đóng phiên). */
  async completeCheckedIn(tableSessionId: string, session: ClientSession) {
    return ReservationModel.findOneAndUpdate(
      { tableSessionId, status: 'CHECKED_IN' },
      { $set: { status: 'COMPLETED', closedAt: new Date() }, $inc: { version: 1 } },
      { new: true, session },
    );
  },
  async findCheckedIn(tableSessionId: string, session: ClientSession) {
    return ReservationModel.findOne({ tableSessionId, status: 'CHECKED_IN' }).session(session);
  },
  async save(reservation: ReservationDoc, session: ClientSession): Promise<void> {
    await reservation.save({ session });
  },
  /** Bàn có lịch còn hiệu lực giao với [start, end). */
  async tablesHeldDuring(start: Date, end: Date, now: Date) {
    return ReservationModel.distinct('tableId', {
      ...liveReservationFilter(now),
      startsAt: { $lt: end },
      endsAt: { $gt: start },
    });
  },
  /** Lịch theo khóa idempotency (người tạo + requestId), kèm requestHash để so nội dung. */
  async findByRequest(
    filter: { actorId: string; actorType: string; requestId: string },
    session?: ClientSession | null,
  ) {
    return ReservationModel.findOne(filter)
      .select('+requestHash')
      .session(session ?? null);
  },
  async countLiveForMember(memberId: string, session: ClientSession): Promise<number> {
    return ReservationModel.countDocuments({ memberId, ...liveReservationFilter() }).session(
      session,
    );
  },
  async memberHasLiveOverlap(
    memberId: string,
    start: Date,
    end: Date,
    session: ClientSession,
  ): Promise<boolean> {
    return !!(await ReservationModel.exists({
      memberId,
      ...liveReservationFilter(),
      startsAt: { $lt: end },
      endsAt: { $gt: start },
    }).session(session));
  },
  async create(data: Record<string, unknown>, session: ClientSession) {
    const [reservation] = await ReservationModel.create([data], { session });
    return reservation;
  },
  /** 30 lịch mỗi trang; lịch sử mới nhất trước, lịch sắp tới gần nhất trước. */
  async page(filter: Record<string, unknown>, newestFirst: boolean, page: number) {
    return Promise.all([
      ReservationModel.find(filter)
        .sort({ startsAt: newestFirst ? -1 : 1 })
        .skip((page - 1) * 30)
        .limit(30),
      ReservationModel.countDocuments(filter),
    ]);
  },
  async findScoped(id: string, scope: Record<string, unknown>, session: ClientSession) {
    return ReservationModel.findOne({ _id: id, ...scope }).session(session);
  },
  /** Lịch đã xác nhận quá hạn đến (tối đa 200, quá hạn lâu nhất trước). */
  async listOverdue(now: Date) {
    return ReservationModel.find({ status: 'CONFIRMED', arrivalDeadline: { $lte: now } })
      .sort({ arrivalDeadline: 1 })
      .limit(200)
      .select('_id tableId');
  },
  async markNoShow(id: unknown, now: Date, session: ClientSession) {
    return ReservationModel.findOneAndUpdate(
      { _id: id, status: 'CONFIRMED', arrivalDeadline: { $lte: now } },
      {
        $set: { status: 'NO_SHOW', closedAt: now, reason: 'Quá giờ đến 15 phút' },
        $inc: { version: 1 },
      },
      { new: true, session },
    );
  },
};
