import type { ClientSession } from 'mongoose';
import {
  JukeboxActionModel,
  JukeboxStateModel,
  JukeboxTrackModel,
  JukeboxVoteModel,
} from '../models/Jukebox.js';

const CLEARED = { trackId: null, selectedAt: null };

export const jukeboxStateRepository = {
  /** Trạng thái duy nhất "main", tạo nếu chưa có; tăng version để mọi thao tác jukebox xếp hàng. */
  async lock(session: ClientSession) {
    return (await JukeboxStateModel.findOneAndUpdate(
      { _id: 'main' },
      { $inc: { version: 1 } },
      { session, new: true, upsert: true, setDefaultsOnInsert: true },
    ))!;
  },
  async read() {
    return JukeboxStateModel.findById('main');
  },
};

export const jukeboxActionRepository = {
  async find(actor: string, requestId: string, session: ClientSession) {
    return JukeboxActionModel.findOne({ actor, requestId }).session(session);
  },
  async record(
    data: { actor: string; requestId: string; hash: string; resultId?: string },
    session: ClientSession,
  ): Promise<void> {
    await JukeboxActionModel.create([data], { session });
  },
};

export const jukeboxTrackRepository = {
  async listEnabled(session?: ClientSession | null) {
    return JukeboxTrackModel.find({ enabled: true })
      .sort({ title: 1, _id: 1 })
      .session(session ?? null);
  },
  async listAll() {
    return JukeboxTrackModel.find().sort({ title: 1, _id: 1 });
  },
  async isEnabled(id: string, session: ClientSession): Promise<boolean> {
    return !!(await JukeboxTrackModel.exists({ _id: id, enabled: true }).session(session));
  },
  async findById(id: string, session: ClientSession) {
    return JukeboxTrackModel.findById(id).session(session);
  },
  newTrack() {
    return new JukeboxTrackModel();
  },
  async count(session: ClientSession): Promise<number> {
    return JukeboxTrackModel.countDocuments().session(session);
  },
};

export const jukeboxVoteRepository = {
  /** Phiếu còn lượt của các phiên đang mở cho các bài đang bật. */
  async listCounting(
    tableSessionIds: unknown[],
    trackIds: unknown[],
    maxUses: number,
    session?: ClientSession | null,
  ) {
    return JukeboxVoteModel.find({
      tableSessionId: { $in: tableSessionIds },
      trackId: { $in: trackIds },
      used: { $lt: maxUses },
    }).session(session ?? null);
  },
  async findForSession(tableSessionId: string, session?: ClientSession | null) {
    return JukeboxVoteModel.findOne({ tableSessionId }).session(session ?? null);
  },
  newVote(tableSessionId: string) {
    return new JukeboxVoteModel({ tableSessionId });
  },
  /** Bỏ chọn bài ở mọi phiếu đang chọn bài này (bài bị tắt hoặc vừa phát). */
  async clearTrack(trackId: unknown, session: ClientSession): Promise<void> {
    await JukeboxVoteModel.updateMany(
      { trackId },
      { $set: CLEARED, $inc: { version: 1 } },
      { session },
    );
  },
  /** Phiếu đã góp vào bài vừa phát: bỏ chọn và tính một lượt đã dùng. */
  async consume(ids: unknown[], session: ClientSession): Promise<void> {
    await JukeboxVoteModel.updateMany(
      { _id: { $in: ids } },
      { $set: CLEARED, $inc: { used: 1, version: 1 } },
      { session },
    );
  },
  async listVotingSessions(session: ClientSession) {
    return JukeboxVoteModel.distinct('tableSessionId', { trackId: { $ne: null } }).session(session);
  },
};
