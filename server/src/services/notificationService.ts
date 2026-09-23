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

export async function notifyStaff(event: RealtimeEvent, data: unknown): Promise<void> {
  await queuedOrDirect({ scope: 'staff' }, event, data);
}

export async function notifySession(tableSessionId: string, event: RealtimeEvent, data: unknown): Promise<void> {
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

async function queuedOrDirect(target: RealtimeTarget, event: RealtimeEvent, data: unknown): Promise<void> {
  try {
    if (await enqueueRealtimeJob(target, event, data)) return;
  } catch (error) {
    logger.warn({ err: error, event, target }, 'notification queue unavailable; using direct emitter');
  }
  if (target.scope === 'all') publishMenuChange();
  else if (target.scope === 'staff') publishStaff(event, data);
  else if (target.scope === 'session') publishSession(target.tableSessionId, event, data);
  else publishGuest(target.tableSessionId, target.participantId, event, data);
}
