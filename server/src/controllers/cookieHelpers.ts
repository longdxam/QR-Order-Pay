import type { Response } from 'express';
import { config } from '../config/index.js';

export function setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie('mc_refresh', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    domain: config.cookieDomain,
    expires: expiresAt,
    path: '/api/v1/auth',
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie('mc_refresh', {
    domain: config.cookieDomain,
    path: '/api/v1/auth',
  });
}
