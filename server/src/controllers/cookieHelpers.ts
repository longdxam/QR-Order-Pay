import type { Request, Response } from 'express';
import { config } from '../config/index.js';

const DEFAULT_REFRESH_COOKIE = 'mc_refresh';
const STAFF_REFRESH_COOKIE = 'mc_refresh_staff';
const ADMIN_REFRESH_COOKIE = 'mc_refresh_admin';

export function refreshCookieName(req: Request): string {
  const origin = requestOrigin(req);
  if (origin === config.staffAppUrl) return STAFF_REFRESH_COOKIE;
  if (origin === config.adminAppUrl) return ADMIN_REFRESH_COOKIE;
  return DEFAULT_REFRESH_COOKIE;
}

export function setRefreshCookie(req: Request, res: Response, token: string, expiresAt: Date): void {
  res.cookie(refreshCookieName(req), token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    domain: config.cookieDomain,
    expires: expiresAt,
    path: '/api/v1/auth',
  });
}

export function clearRefreshCookie(req: Request, res: Response): void {
  res.clearCookie(refreshCookieName(req), {
    domain: config.cookieDomain,
    path: '/api/v1/auth',
  });
}

function requestOrigin(req: Request): string | null {
  const origin = req.headers.origin;
  if (typeof origin === 'string') return origin;
  const referer = req.headers.referer;
  if (typeof referer !== 'string') return null;
  try {
    const url = new URL(referer);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}
