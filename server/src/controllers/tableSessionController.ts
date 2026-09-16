import type { Request, Response, NextFunction } from 'express';
import { joinTableRequestSchema } from '@may-cafe/contracts';
import { joinAsGuest, listOpenSessions, openSession, transition } from '../services/tableSessionService.js';
import { setGuestCookie, setReceiptCookie, clearGuestCookie, resolveReceiptGuest } from '../middlewares/guest.js';
import { listOpenServiceRequests } from '../services/serviceRequestService.js';
import { buildBill } from '../services/paymentService.js';
import { NotFoundError } from '../errors/AppError.js';
import { tableRepository } from '../repositories/tableRepository.js';
import { tableSessionRepository } from '../repositories/tableSessionRepository.js';
import { guestSessionRepository } from '../repositories/guestSessionRepository.js';
import { GUEST_COOKIE } from '../middlewares/guest.js';
import { sha256 } from '../utils/crypto.js';
import { GuestSessionModel } from '../models/GuestSession.js';
import { RECEIPT_COOKIE } from '../middlewares/guest.js';
import { closeGuestSockets, closeSessionSockets, publishSession, publishStaff } from '../realtime/socket.js';

export async function join(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = joinTableRequestSchema.parse(req.body);
    if (req.guest) {
      const table = await tableRepository.findByPublicTokenHash(sha256(input.tableToken));
      const session = await tableSessionRepository.findById(req.guest.tableSessionId);
      if (table?.isActive && session && session.tableId.toString() === table.id) {
        res.json({ success: true, data: { participantId: req.guest.participantId, tableSessionId: session.id } });
        return;
      }
    }
    const result = await joinAsGuest(input.tableToken);
    setGuestCookie(res, result.guestToken);
    setReceiptCookie(res, result.receiptToken);
    res.json({
      success: true,
      data: {
        guestSessionId: result.guestId,
        participantId: result.participantId,
        tableSessionId: result.tableSession._id.toString(),
        table: {
          id: result.table._id.toString(),
          code: result.table.code,
          name: result.table.name,
          capacity: result.table.capacity,
        },
        tableSession: {
          id: result.tableSession._id.toString(),
          status: result.tableSession.status,
          startedAt: result.tableSession.startedAt,
        },
      },
    });
  } catch (e) {
    next(e);
  }
}

export async function current(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.guest) {
      const receipt = await resolveReceiptGuest(req);
      res.json({ success: true, data: { active: false, receiptAvailable: !!receipt } });
      return;
    }
    const session = await tableSessionRepository.findById(req.guest.tableSessionId);
    const table = session ? await tableRepository.findById(session.tableId.toString()) : null;
    res.json({
      success: true,
      data: {
        active: true,
        tableSessionId: req.guest.tableSessionId,
        participantId: req.guest.participantId,
        status: session?.status,
        table: table ? { id: table.id, code: table.code, name: table.name } : null,
      },
    });
  } catch (e) {
    next(e);
  }
}

export async function leave(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.cookies?.[GUEST_COOKIE];
    if (typeof token === 'string') await guestSessionRepository.revokeByHash(sha256(token));
    const receipt = req.cookies?.[RECEIPT_COOKIE];
    if (typeof receipt === 'string') await GuestSessionModel.updateOne({ receiptTokenHash: sha256(receipt) }, { $unset: { receiptTokenHash: 1 } });
    clearGuestCookie(res);
    if (req.guest) closeGuestSockets(req.guest.tableSessionId, req.guest.participantId);
    res.json({ success: true, data: { ok: true } });
  } catch (e) { next(e); }
}

export async function staffTables(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tables = (await tableRepository.list()).map((t) => ({ _id: t.id, code: t.code, name: t.name, capacity: t.capacity, isActive: t.isActive }));
    res.json({ success: true, data: { tables } });
  } catch (e) { next(e); }
}

export async function staffList(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const items = await listOpenSessions();
    res.json({ success: true, data: { items } });
  } catch (e) {
    next(e);
  }
}

export async function staffOpen(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw new NotFoundError();
    const tableId = String(req.params['tableId'] ?? '');
    if (!tableId) {
      res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Thiếu tableId.' } });
      return;
    }
    const session = await openSession(tableId, req.user.id);
    publishStaff('tableSession.statusChanged', { tableSessionId: session.id, status: session.status });
    res.json({ success: true, data: { session } });
  } catch (e) {
    next(e);
  }
}

export async function staffTransition(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw new NotFoundError();
    const id = String(req.params['id'] ?? '');
    const { status, expectedVersion } = req.body as { status?: string; expectedVersion?: number };
    if (!status || typeof expectedVersion !== 'number') {
      res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Thiếu trạng thái hoặc phiên bản.' } });
      return;
    }
    const updated = await transition(id, expectedVersion, status as 'OPEN' | 'CHECKOUT' | 'CLOSED', req.user.id);
    const payload = { tableSessionId: id, status: updated.status };
    publishStaff('tableSession.statusChanged', payload);
    publishSession(id, 'tableSession.statusChanged', payload);
    if (updated.status === 'CLOSED') closeSessionSockets(id);
    if (updated.status === 'CLOSED') publishStaff('serviceRequest.resolved', { tableSessionId: id });
    res.json({ success: true, data: { session: updated } });
  } catch (e) {
    next(e);
  }
}

export async function staffBill(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = String(req.params['id'] ?? '');
    const bill = await buildBill(id);
    res.json({ success: true, data: bill });
  } catch (e) {
    next(e);
  }
}

export async function staffServiceRequests(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const items = await listOpenServiceRequests();
    res.json({ success: true, data: { items } });
  } catch (e) {
    next(e);
  }
}
