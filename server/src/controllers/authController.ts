import type { Request, Response, NextFunction } from 'express';
import { login as loginSvc, refresh as refreshSvc, logout as logoutSvc, logoutAll as logoutAllSvc } from '../services/authService.js';
import { loginRequestSchema } from '@may-cafe/contracts';
import { setRefreshCookie, clearRefreshCookie } from './cookieHelpers.js';

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = loginRequestSchema.parse(req.body);
    const result = await loginSvc({
      email: input.email,
      password: input.password,
      userAgent: req.headers['user-agent'] ?? '',
      ip: req.ip ?? '',
    });
    setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt);
    res.json({ success: true, data: { accessToken: result.accessToken, user: result.user } });
  } catch (e) {
    next(e);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.cookies?.['mc_refresh'];
    if (!token || typeof token !== 'string') {
      res.status(401).json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Thiếu refresh token.' } });
      return;
    }
    const result = await refreshSvc({
      refreshToken: token,
      userAgent: req.headers['user-agent'] ?? '',
      ip: req.ip ?? '',
    });
    setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt);
    res.json({ success: true, data: { accessToken: result.accessToken, user: result.user } });
  } catch (e) {
    next(e);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.cookies?.['mc_refresh'];
    if (typeof token === 'string') {
      await logoutSvc(token);
    }
    clearRefreshCookie(res);
    res.json({ success: true, data: { ok: true } });
  } catch (e) {
    next(e);
  }
}

export async function logoutAll(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Thiếu phiên.' } });
      return;
    }
    await logoutAllSvc(req.user.id);
    clearRefreshCookie(res);
    res.json({ success: true, data: { ok: true } });
  } catch (e) {
    next(e);
  }
}

export async function me(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Thiếu phiên.' } });
      return;
    }
    res.json({ success: true, data: req.user });
  } catch (e) {
    next(e);
  }
}
