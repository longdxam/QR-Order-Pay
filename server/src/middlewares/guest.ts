import { sha256 } from '../utils/crypto.js';
import { guestSessionRepository } from '../repositories/guestSessionRepository.js';
import { tableSessionRepository } from '../repositories/tableSessionRepository.js';
import { ForbiddenError, UnauthorizedError } from '../errors/AppError.js';
import type { Request, Response, NextFunction } from 'express';
import { config } from '../config/index.js';
import { auditRepository } from '../repositories/auditRepository.js';
import { GuestSessionModel } from '../models/GuestSession.js';

export const GUEST_COOKIE = 'mc_guest';
export const RECEIPT_COOKIE = 'mc_receipt';
export const GUEST_COOKIE_TTL_MS = 1000 * 60 * 60 * 12; // 12h

export interface ResolvedGuest {
  id: string;
  tableSessionId: string;
  participantId: string;
}

export async function resolveGuest(req: Request): Promise<ResolvedGuest | null> {
  const cookie = req.cookies?.[GUEST_COOKIE];
  if (!cookie || typeof cookie !== 'string') return null;
  const hash = sha256(cookie);
  const session = await guestSessionRepository.findActiveByTokenHash(hash);
  if (!session) return null;
  const tableSession = await tableSessionRepository.findById(session.tableSessionId);
  if (!tableSession || tableSession.status === 'CLOSED') return null;
  return { id: session.id, tableSessionId: session.tableSessionId, participantId: session.participantId };
}

export function attachGuest(req: Request, guest: ResolvedGuest): void {
  req.guest = guest;
}

export async function loadGuest(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const guest = await resolveGuest(req);
    if (guest) attachGuest(req, guest);
    next();
  } catch (e) {
    next(e);
  }
}

export function requireGuest(req: Request, _res: Response, next: NextFunction): void {
  if (!req.guest) return next(new UnauthorizedError('Vui lòng quét QR tại bàn để tiếp tục.'));
  next();
}

export function requireOpenTableSession(req: Request, _res: Response, next: NextFunction): void {
  if (!req.guest) return next(new UnauthorizedError());
  // Service layer re-checks status; here we only short-circuit obvious cases.
  next();
}

// A separate, limited capability: never accepted by ordering or socket authentication.
export async function resolveReceiptGuest(req: Request): Promise<ResolvedGuest | null> {
  const token = req.cookies?.[RECEIPT_COOKIE];
  if (typeof token !== 'string') return null;
  const guest = await GuestSessionModel.findOne({ receiptTokenHash: sha256(token), expiresAt: { $gt: new Date() } });
  if (!guest) return null;
  const session = await tableSessionRepository.findById(guest.tableSessionId.toString());
  if (!session || session.status !== 'CLOSED') return null;
  return { id: guest.id, participantId: guest.participantId, tableSessionId: session.id };
}

export async function loadReceiptGuest(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const guest = await resolveReceiptGuest(req);
    if (!guest) throw new UnauthorizedError('Chưa có hóa đơn đã đóng hoặc quyền xem đã hết hạn.');
    req.guest = guest;
    next();
  } catch (e) { next(e); }
}

export function setReceiptCookie(res: Response, token: string): void {
  res.cookie(RECEIPT_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: config.cookieSecure,
    domain: config.cookieDomain, maxAge: GUEST_COOKIE_TTL_MS, path: '/',
  });
}

export function setGuestCookie(res: Response, token: string): void {
  res.cookie(GUEST_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    domain: config.cookieDomain,
    maxAge: GUEST_COOKIE_TTL_MS,
    path: '/',
  });
}

export function clearGuestCookie(res: Response): void {
  res.clearCookie(RECEIPT_COOKIE, { domain: config.cookieDomain, path: '/' });
  res.clearCookie(GUEST_COOKIE, {
    domain: config.cookieDomain,
    path: '/',
  });
}

export function guestCsrfGuard(req: Request, _res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const allowed = new Set<string>([config.serverOrigin, config.publicAppUrl]);
  if (origin && !allowed.has(origin)) return next(new ForbiddenError('Nguồn yêu cầu không hợp lệ.'));
  if (!origin && referer) {
    try {
      const refUrl = new URL(referer);
      if (!allowed.has(`${refUrl.protocol}//${refUrl.host}`)) {
        return next(new ForbiddenError('Nguồn yêu cầu không hợp lệ.'));
      }
    } catch {
      return next(new ForbiddenError('Nguồn yêu cầu không hợp lệ.'));
    }
  }
  next();
}

export { auditRepository };
