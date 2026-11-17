import crypto from 'node:crypto';
import { z } from 'zod';
import type { ClientSession } from 'mongoose';
import {
  JUKEBOX_VOTES_PER_SESSION,
  JUKEBOX_LEASE_MS,
  jukeboxTrackSchema,
  jukeboxVoteSchema,
  jukeboxDeviceSchema,
  jukeboxControlSchema,
  jukeboxPlaySchema,
  type JukeboxFeed,
  type JukeboxStaffFeed,
} from '@may-cafe/contracts';
import type { JukeboxStateDoc } from '../models/Jukebox.js';
import {
  jukeboxActionRepository,
  jukeboxStateRepository,
  jukeboxTrackRepository,
  jukeboxVoteRepository,
} from '../repositories/jukeboxRepository.js';
import { tableSessionRepository } from '../repositories/tableSessionRepository.js';
import { unitOfWork } from '../infrastructure/unitOfWork.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../errors/AppError.js';
import { outboxRepository } from '../repositories/outboxRepository.js';
import { auditRepository } from '../repositories/auditRepository.js';
interface JukeboxActor {
  tableSessionId: string;
  participantId: string;
}

const idSchema = z.string().regex(/^[a-f\d]{24}$/i);
// Every mutation writes this singleton in the same transaction: catalog/vote/advance races serialize.
async function lock(session: ClientSession) {
  return jukeboxStateRepository.lock(session);
}
const hash = (body: unknown) =>
  crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
async function replay(actor: string, requestId: string, body: unknown, session: ClientSession) {
  const prior = await jukeboxActionRepository.find(actor, requestId, session);
  if (prior && prior.hash !== hash(body))
    throw new ConflictError('JUKEBOX_CONFLICT', 'Mã yêu cầu đã được dùng cho thao tác khác.');
  return prior;
}
async function record(
  actor: string,
  requestId: string,
  body: unknown,
  state: JukeboxStateDoc,
  session: ClientSession,
  resultId?: string,
) {
  await jukeboxActionRepository.record({ actor, requestId, hash: hash(body), resultId }, session);
  await auditRepository.log(
    {
      actorType: actor.startsWith('user:') ? 'USER' : 'GUEST',
      ...(actor.startsWith('user:') ? { actorId: actor.slice(5) } : {}),
      action: 'jukebox.changed',
      entityType: 'Jukebox',
      entityId: 'main',
      metadata: { operation: (body as { kind: string }).kind },
    },
    session,
  );
  await outboxRepository.createRealtimeEvents(
    [
      {
        eventType: 'jukebox.changed',
        aggregateType: 'Jukebox',
        aggregateId: 'main',
        aggregateVersion: state.version,
        target: { scope: 'all' },
        payload: { refresh: true },
      },
    ],
    session,
  );
}
const trackView = (t: { _id: unknown; title: string; artist: string }) => ({
  id: String(t._id),
  title: t.title,
  artist: t.artist,
});
async function queue(session?: ClientSession) {
  const tracks = await jukeboxTrackRepository.listEnabled(session);
  const active = await tableSessionRepository.listOpenIds(session);
  const votes = await jukeboxVoteRepository.listCounting(
    active,
    tracks.map((t) => t._id),
    JUKEBOX_VOTES_PER_SESSION,
    session,
  );
  const tally = new Map<string, { votes: number; first: number }>();
  for (const v of votes) {
    const key = String(v.trackId),
      prev = tally.get(key),
      time = v.selectedAt?.getTime() ?? 0;
    tally.set(key, { votes: (prev?.votes ?? 0) + 1, first: Math.min(prev?.first ?? time, time) });
  }
  const ranked = tracks
    .filter((t) => tally.has(t.id))
    .sort((a, b) => {
      const av = tally.get(a.id)!,
        bv = tally.get(b.id)!;
      return bv.votes - av.votes || av.first - bv.first || a.id.localeCompare(b.id);
    });
  return { tracks, ranked, tally, votes };
}
export async function jukeboxFeed(actor?: JukeboxActor): Promise<JukeboxFeed> {
  const [state, q, vote, table] = await Promise.all([
    jukeboxStateRepository.read(),
    queue(),
    actor ? jukeboxVoteRepository.findForSession(actor.tableSessionId) : null,
    actor ? tableSessionRepository.findById(actor.tableSessionId) : null,
  ]);
  if (actor && (!table || table.status === 'CLOSED'))
    throw new ForbiddenError('Phiên bàn đã kết thúc.');
  const selected =
    vote?.trackId && q.tracks.some((t) => t.id === String(vote.trackId))
      ? String(vote.trackId)
      : null;
  return {
    tracks: q.tracks.map(trackView),
    queue: q.ranked.map((t) => ({ ...trackView(t), votes: q.tally.get(t.id)!.votes })),
    current: state?.current?.trackId
      ? { id: state.current.trackId, title: state.current.title!, artist: state.current.artist! }
      : null,
    playbackVersion: state?.playbackVersion ?? 0,
    serverNow: Date.now(),
    vote: actor
      ? {
          trackId: selected,
          version: vote?.version ?? 0,
          remaining: Math.max(0, JUKEBOX_VOTES_PER_SESSION - (vote?.used ?? 0)),
          canVote: table?.status === 'OPEN' && (vote?.used ?? 0) < JUKEBOX_VOTES_PER_SESSION,
        }
      : null,
  };
}
export async function voteJukebox(actor: JukeboxActor, input: unknown) {
  const body = jukeboxVoteSchema.parse(input),
    who = `table:${actor.tableSessionId}`,
    data = { kind: 'vote', ...body };
  await unitOfWork.withTransaction(async (session) => {
    const table = await tableSessionRepository.touchOpen(actor.tableSessionId, session);
    if (!table) throw new ForbiddenError('Chỉ bình chọn khi phiên bàn đang mở.');
    const state = await lock(session);
    if (await replay(who, body.requestId, data, session)) return;
    let vote = await jukeboxVoteRepository.findForSession(actor.tableSessionId, session);
    if ((vote?.version ?? 0) !== body.expectedVersion)
      throw new ConflictError('JUKEBOX_CONFLICT', 'Bàn vừa đổi lựa chọn. Hãy tải lại.');
    if (body.trackId) {
      if ((vote?.used ?? 0) >= JUKEBOX_VOTES_PER_SESSION)
        throw new ConflictError('JUKEBOX_CONFLICT', 'Bàn đã dùng hết lượt bình chọn trong phiên.');
      if (state.current?.trackId === body.trackId)
        throw new ConflictError('JUKEBOX_CONFLICT', 'Bài này đang được chọn phát.');
      if (!(await jukeboxTrackRepository.isEnabled(body.trackId, session)))
        throw new NotFoundError('Bài hát không còn mở bình chọn.');
    }
    vote ??= jukeboxVoteRepository.newVote(actor.tableSessionId);
    if (String(vote.trackId ?? '') !== (body.trackId ?? ''))
      vote.selectedAt = body.trackId ? new Date() : null;
    vote.trackId = body.trackId as typeof vote.trackId;
    vote.version += 1;
    await vote.save({ session });
    await record(who, body.requestId, data, state, session);
  });
  return jukeboxFeed(actor);
}
export async function jukeboxCatalog() {
  return (await jukeboxTrackRepository.listAll()).map((t) => ({
    ...trackView(t),
    audioUrl: t.audioUrl,
    enabled: t.enabled,
    version: t.version,
  }));
}
export async function saveJukeboxTrack(userId: string, rawId: string | null, input: unknown) {
  const id = rawId ? idSchema.parse(rawId) : null,
    body = jukeboxTrackSchema.parse(input),
    data = { kind: 'track', id, ...body },
    who = `user:${userId}`;
  return unitOfWork.withTransaction(async (session) => {
    const state = await lock(session),
      old = await replay(who, body.requestId, data, session);
    if (old) return { id: old.resultId };
    const track = id
      ? await jukeboxTrackRepository.findById(id, session)
      : jukeboxTrackRepository.newTrack();
    if (!track) throw new NotFoundError('Không tìm thấy bài hát.');
    if ((track.version ?? 0) !== body.expectedVersion)
      throw new ConflictError('JUKEBOX_CONFLICT', 'Bài hát vừa được sửa. Hãy tải lại.');
    if (!id && (await jukeboxTrackRepository.count(session)) >= 100)
      throw new ConflictError('JUKEBOX_CONFLICT', 'Danh sách tối đa 100 bài. Hãy sửa bài hiện có.');
    Object.assign(track, {
      title: body.title,
      artist: body.artist,
      audioUrl: body.audioUrl,
      enabled: body.enabled,
      version: body.expectedVersion + 1,
    });
    await track.save({ session });
    if (!body.enabled) await jukeboxVoteRepository.clearTrack(track._id, session);
    await record(who, body.requestId, data, state, session, track.id);
    return { id: track.id };
  });
}
function owns(state: JukeboxStateDoc | null, userId: string, deviceId: string) {
  return (
    !!state &&
    state.leaseUserId === userId &&
    state.leaseDeviceId === deviceId &&
    (state.leaseUntil?.getTime() ?? 0) > Date.now()
  );
}
export async function staffJukeboxFeed(userId: string, input: unknown): Promise<JukeboxStaffFeed> {
  const { deviceId } = jukeboxDeviceSchema.parse(input);
  const feed = await jukeboxFeed(),
    state = await jukeboxStateRepository.read();
  const owned = owns(state, userId, deviceId),
    until = state?.leaseUntil?.getTime() ?? 0;
  return {
    ...feed,
    playbackVersion: state?.playbackVersion ?? 0,
    current: state?.current?.trackId
      ? {
          id: state.current.trackId,
          title: state.current.title!,
          artist: state.current.artist!,
          audioUrl: owned ? state.current.audioUrl! : '',
        }
      : null,
    lease: { owned, busy: until > Date.now(), until },
  };
}
export async function leaseJukebox(
  userId: string,
  kind: 'claim' | 'heartbeat' | 'release',
  input: unknown,
) {
  const { deviceId } = jukeboxDeviceSchema.parse(input);
  await unitOfWork.withTransaction(async (session) => {
    const state = await lock(session),
      owned = owns(state, userId, deviceId);
    if (!owned && (kind !== 'claim' || (state.leaseUntil?.getTime() ?? 0) > Date.now()))
      throw new ConflictError(
        'JUKEBOX_CONFLICT',
        'Thiết bị khác đang giữ quyền phát hoặc quyền phát đã hết hạn.',
      );
    state.leaseUserId = kind === 'release' ? null : userId;
    state.leaseDeviceId = kind === 'release' ? null : deviceId;
    state.leaseUntil = kind === 'release' ? null : new Date(Date.now() + JUKEBOX_LEASE_MS);
    await state.save({ session });
  });
  return staffJukeboxFeed(userId, { deviceId });
}
export async function controlJukebox(
  userId: string,
  kind: 'next' | 'stop' | 'play',
  input: unknown,
) {
  const body = kind === 'play' ? jukeboxPlaySchema.parse(input) : jukeboxControlSchema.parse(input),
    data = { kind, ...body },
    who = `user:${userId}`;
  await unitOfWork.withTransaction(async (session) => {
    const state = await lock(session);
    if (!owns(state, userId, body.deviceId))
      throw new ConflictError('JUKEBOX_CONFLICT', 'Hãy bật thiết bị phát tại quầy trước.');
    if (await replay(who, body.requestId, data, session)) return;
    if (state.playbackVersion !== body.playbackVersion)
      throw new ConflictError('JUKEBOX_CONFLICT', 'Bài phát đã đổi. Hãy tải lại.');
    state.current = null;
    if (kind === 'next' || kind === 'play') {
      const voters = await jukeboxVoteRepository.listVotingSessions(session);
      await tableSessionRepository.touchOpenMany(voters, session);
      const q = await queue(session),
        next =
          kind === 'play' && 'trackId' in body
            ? q.tracks.find((track) => track.id === body.trackId)
            : q.ranked[0];
      if (kind === 'play' && !next) throw new NotFoundError('Bài hát không tồn tại hoặc đã tắt.');
      if (next) {
        state.current = {
          trackId: next.id,
          title: next.title,
          artist: next.artist,
          audioUrl: next.audioUrl,
        };
        await jukeboxVoteRepository.consume(
          q.votes.filter((v) => String(v.trackId) === next.id).map((v) => v._id),
          session,
        );
        // A ballot parked in CHECKOUT cannot requeue the same already-selected song after reopen.
        await jukeboxVoteRepository.clearTrack(next._id, session);
      }
    }
    state.playbackVersion += 1;
    await state.save({ session });
    await record(who, body.requestId, data, state, session);
  });
  return staffJukeboxFeed(userId, { deviceId: body.deviceId });
}
