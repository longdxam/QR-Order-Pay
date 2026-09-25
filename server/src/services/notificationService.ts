import {
  enqueueRealtimeJob,
  type RealtimeEvent,
  type RealtimeTarget,
} from '../infrastructure/backgroundQueue.js';
import {
  publishGuest,
  publishMenuChange,
  publishSession,
  publishStaff,
} from '../realtime/socket.js';
import { logger } from '../infrastructure/logger.js';
import { randomUUID } from 'node:crypto';

export async function notifyStaff(event: RealtimeEvent, data: unknown): Promise<void> {
  await queuedOrDirect({ scope: 'staff' }, event, data);
}

export async function notifySession(
  tableSessionId: string,
  event: RealtimeEvent,
  data: unknown,
): Promise<void> {
  await queuedOrDirect({ scope: 'session', tableSessionId }, event, data);
}

export async function notifyGuest(
  tableSessionId: string,
  participantId: string,
  event: RealtimeEvent,
  data: unknown,
): Promise<void> {
  await queuedOrDirect({ scope: 'guest', tableSessionId, participantId }, event, data);
}

export async function notifyMenuChange(): Promise<void> {
  await queuedOrDirect({ scope: 'all' }, 'menu.availabilityChanged', {});
}

async function queuedOrDirect(
  target: RealtimeTarget,
  event: RealtimeEvent,
  data: unknown,
): Promise<void> {
  const eventId = randomUUID();
  const occurredAt = new Date().toISOString();
  try {
    if (await enqueueRealtimeJob(target, event, data, { id: eventId, createdAt: occurredAt }))
      return;
  } catch (error) {
    logger.warn(
      { err: error, event, target },
      'notification queue unavailable; using direct emitter',
    );
  }
  const entityId =
    target.scope === 'session' || target.scope === 'guest' ? target.tableSessionId : 'catalog';
  const envelope = {
    eventId,
    eventType: event,
    schemaVersion: 1,
    entityId,
    entityVersion: 0,
    occurredAt,
    data,
  };
  if (target.scope === 'all') publishMenuChange(envelope);
  else if (target.scope === 'staff') publishStaff(event, envelope);
  else if (target.scope === 'session') publishSession(target.tableSessionId, event, envelope);
  else publishGuest(target.tableSessionId, target.participantId, event, envelope);
}
