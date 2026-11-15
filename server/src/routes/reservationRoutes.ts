import { Router } from 'express';
import * as reservations from '../controllers/reservationController.js';
import { guestCsrfGuard } from '../middlewares/guest.js';
import { portalPrefixes } from './guards.js';
import { authLimiter, guestMutationLimiter } from './rateLimits.js';

/** Đặt bàn theo khung giờ: khách công khai và Staff/Admin. */
export const reservationRoutes = Router();

reservationRoutes.get('/reservations/availability', authLimiter, reservations.availability(false));
reservationRoutes.get('/reservations', authLimiter, reservations.list(false));
reservationRoutes.post(
  '/reservations',
  guestCsrfGuard,
  guestMutationLimiter,
  reservations.create(false),
);
reservationRoutes.post(
  '/reservations/:id/cancel',
  guestCsrfGuard,
  guestMutationLimiter,
  reservations.action(false, 'cancel'),
);

for (const { prefix: portal, guard } of portalPrefixes) {
  const prefix = `${portal}/reservations`;
  reservationRoutes.use(prefix, ...guard);
  reservationRoutes.get(`${prefix}/availability`, reservations.availability(true));
  reservationRoutes.get(prefix, reservations.list(true));
  reservationRoutes.post(prefix, reservations.create(true));
  reservationRoutes.post(`${prefix}/:id/cancel`, reservations.action(true, 'cancel'));
  reservationRoutes.post(`${prefix}/:id/check-in`, reservations.action(true, 'check-in'));
}
