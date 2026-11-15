import { Router } from 'express';
import * as auth from '../controllers/authController.js';
import * as promotion from '../controllers/promotionController.js';
import { requireAuth } from '../middlewares/auth.js';
import { guestCsrfGuard } from '../middlewares/guest.js';
import { adminOnly } from './guards.js';
import { authLimiter } from './rateLimits.js';

/** Đăng nhập nội bộ, thành viên tích điểm và voucher. */
export const accountRoutes = Router();

accountRoutes.post('/auth/login', authLimiter, auth.login);
accountRoutes.post('/auth/refresh', authLimiter, auth.refresh);
accountRoutes.post('/auth/logout', authLimiter, auth.logout);
accountRoutes.post('/auth/logout-all', authLimiter, requireAuth, auth.logoutAll);
accountRoutes.get('/auth/me', requireAuth, auth.me);
accountRoutes.patch('/auth/me', authLimiter, requireAuth, auth.profile);
accountRoutes.post('/auth/password', authLimiter, requireAuth, auth.password);

accountRoutes.get('/members/me', promotion.me);
accountRoutes.post('/members/register', guestCsrfGuard, authLimiter, promotion.register);
accountRoutes.post('/members/login', guestCsrfGuard, authLimiter, promotion.login);
accountRoutes.post('/members/logout', guestCsrfGuard, authLimiter, promotion.logout);
accountRoutes.post('/members/password', guestCsrfGuard, authLimiter, promotion.password);
accountRoutes.get('/members/points', authLimiter, promotion.points);

accountRoutes.get('/admin/members', ...adminOnly, promotion.listMembers);
accountRoutes.patch('/admin/members/:id', ...adminOnly, promotion.updateMember);
accountRoutes.get('/admin/members/:id/points', ...adminOnly, promotion.memberPoints);
accountRoutes.get('/admin/vouchers', ...adminOnly, promotion.vouchers);
accountRoutes.post('/admin/vouchers', ...adminOnly, promotion.createVoucher);
accountRoutes.patch('/admin/vouchers/:id', ...adminOnly, promotion.updateVoucher);
