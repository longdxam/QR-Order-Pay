import type { Server as HttpServer } from 'node:http';
import { Server as IOServer, type Socket } from 'socket.io';
import { config } from '../config/index.js';
import { logger } from '../infrastructure/logger.js';
import { sha256 } from '../utils/crypto.js';
import { guestSessionRepository } from '../repositories/guestSessionRepository.js';
import { tableSessionRepository } from '../repositories/tableSessionRepository.js';
import type { Role } from '@may-cafe/contracts';
import { verifyAccessToken } from '../utils/crypto.js';
import { GUEST_COOKIE } from '../middlewares/guest.js';
import { UserModel } from '../models/User.js';

interface ServerToClientEvents {
  'order.created': (payload: unknown) => void;
  'order.statusChanged': (payload: unknown) => void;
  'menu.availabilityChanged': (payload: unknown) => void;
  'serviceRequest.created': (payload: unknown) => void;
  'serviceRequest.resolved': (payload: unknown) => void;
  'payment.confirmed': (payload: unknown) => void;
  'tableSession.statusChanged': (payload: unknown) => void;
}

let io: IOServer<Record<string, never>, ServerToClientEvents> | null = null;

export function getIO(): IOServer<Record<string, never>, ServerToClientEvents> | null {
  return io;
}

export function createSocketServer(httpServer: HttpServer): IOServer<Record<string, never>, ServerToClientEvents> {
  io = new IOServer(httpServer, {
    cors: { origin: [config.publicAppUrl, config.serverOrigin], credentials: true },
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      callback(null, !origin || [config.publicAppUrl, config.serverOrigin].includes(origin));
    },
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.accessToken as string | undefined;
      const guestToken = socket.handshake.headers.cookie?.split(';').map((part) => part.trim())
        .find((part) => part.startsWith(`${GUEST_COOKIE}=`))?.slice(GUEST_COOKIE.length + 1);
      const role = socket.handshake.auth?.role as Role | undefined;
      if (role === 'STAFF' || role === 'ADMIN') {
        if (!token) return next(new Error('UNAUTHENTICATED'));
        const payload = verifyAccessToken(token);
        const user = await UserModel.findById(payload.sub);
        if (!user?.isActive || !['STAFF', 'ADMIN'].includes(user.role) || user.role !== payload.role) return next(new Error('UNAUTHENTICATED'));
        (socket.data as { role?: string; userId?: string }).role = payload.role;
        (socket.data as { role?: string; userId?: string }).userId = payload.sub;
        return next();
      }
      if (guestToken) {
        const hash = sha256(guestToken);
        const guest = await guestSessionRepository.findActiveByTokenHash(hash);
        if (!guest) return next(new Error('UNAUTHENTICATED'));
        const tableSession = await tableSessionRepository.findById(guest.tableSessionId);
        if (!tableSession || tableSession.status === 'CLOSED') return next(new Error('SESSION_CLOSED'));
        (socket.data as { guestId?: string; tableSessionId?: string; participantId?: string }).guestId = guest.id;
        (socket.data as { guestId?: string; tableSessionId?: string; participantId?: string }).tableSessionId = guest.tableSessionId;
        (socket.data as { guestId?: string; tableSessionId?: string; participantId?: string }).participantId = guest.participantId;
        return next();
      }
      next(new Error('UNAUTHENTICATED'));
    } catch (e) {
      logger.warn({ err: (e as Error).message }, 'socket auth failed');
      next(new Error('UNAUTHENTICATED'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const data = socket.data as {
      role?: string;
      userId?: string;
      guestId?: string;
      tableSessionId?: string;
      participantId?: string;
    };
    if (data.role === 'ADMIN' || data.role === 'STAFF') {
      socket.join('staff');
      socket.join(`staff:${data.userId}`);
    } else if (data.tableSessionId && data.participantId) {
      socket.join(`guest:${data.tableSessionId}:${data.participantId}`);
      socket.join(`session:${data.tableSessionId}`);
    }
    socket.on('disconnect', () => {
      // rooms cleaned automatically
    });
  });

  return io;
}

export function publishStaff<T>(event: keyof ServerToClientEvents, payload: T): void {
  io?.to('staff').emit(event, payload);
}

export function publishSession<T>(tableSessionId: string, event: keyof ServerToClientEvents, payload: T): void {
  io?.to(`session:${tableSessionId}`).emit(event, payload);
}

export function publishGuest<T>(
  tableSessionId: string,
  participantId: string,
  event: keyof ServerToClientEvents,
  payload: T,
): void {
  io?.to(`guest:${tableSessionId}:${participantId}`).emit(event, payload);
}

export function publishMenuChange(): void {
  io?.emit('menu.availabilityChanged', {});
}

export function closeSessionSockets(tableSessionId: string): void {
  io?.in(`session:${tableSessionId}`).disconnectSockets(true);
}

export function closeGuestSockets(tableSessionId: string, participantId: string): void {
  io?.in(`guest:${tableSessionId}:${participantId}`).disconnectSockets(true);
}
