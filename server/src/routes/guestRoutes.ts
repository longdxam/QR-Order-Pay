import { Router } from 'express';
import * as ai from '../controllers/aiController.js';
import * as cancelRequest from '../controllers/cancelRequestController.js';
import * as gifts from '../controllers/giftController.js';
import * as order from '../controllers/orderController.js';
import { currentReceipt } from '../controllers/receiptController.js';
import * as serviceRequest from '../controllers/serviceRequestController.js';
import * as tableDisplay from '../controllers/tableDisplayController.js';
import * as tableSession from '../controllers/tableSessionController.js';
import { requireAiCustomer } from '../middlewares/aiAccess.js';
import { guestCsrfGuard, loadGuest, loadReceiptGuest, requireGuest } from '../middlewares/guest.js';
import {
  aiLimiter,
  guestJoinLimiter,
  guestMutationLimiter,
  guestOrderLimiter,
  guestQuoteLimiter,
  guestServiceLimiter,
  rateLimitOrPassthrough,
} from './rateLimits.js';

/**
 * Luồng khách tại bàn: vào bàn, đặt/hủy đơn, hóa đơn, gọi nhân viên, AI Barista và tặng quà.
 * Mọi thao tác ghi đều qua `guestCsrfGuard`; xem test ma trận route.
 */
export const guestRoutes = Router();

guestRoutes.get(
  '/table-displays/qr',
  rateLimitOrPassthrough(120, 'table-display'),
  tableDisplay.currentQr,
);
guestRoutes.post(
  '/table-sessions/join',
  loadGuest,
  guestCsrfGuard,
  guestJoinLimiter,
  tableSession.join,
);
guestRoutes.get('/table-sessions/current', loadGuest, tableSession.current);
guestRoutes.post('/table-sessions/leave', loadGuest, guestCsrfGuard, tableSession.leave);

guestRoutes.get('/gifts/tables', loadGuest, requireGuest, gifts.tables);
guestRoutes.get('/gifts', loadGuest, requireGuest, gifts.list);
guestRoutes.post(
  '/gifts',
  loadGuest,
  requireGuest,
  guestCsrfGuard,
  guestOrderLimiter,
  gifts.create,
);
guestRoutes.post(
  '/gifts/:id/decision',
  loadGuest,
  requireGuest,
  guestCsrfGuard,
  guestMutationLimiter,
  gifts.decide,
);

guestRoutes.post(
  '/orders/quote',
  loadGuest,
  guestCsrfGuard,
  guestQuoteLimiter,
  requireGuest,
  order.quote,
);
guestRoutes.post(
  '/orders',
  loadGuest,
  guestCsrfGuard,
  guestOrderLimiter,
  requireGuest,
  order.place,
);
// `/orders/mine` phải đứng trước `/orders/:id`.
guestRoutes.get('/orders/mine', loadGuest, requireGuest, order.listMine);
guestRoutes.get('/orders/:id', loadGuest, requireGuest, order.detail);
const guestOrderMutation = [loadGuest, guestCsrfGuard, guestMutationLimiter, requireGuest];
guestRoutes.post('/orders/:id/cancel', ...guestOrderMutation, order.cancel);
guestRoutes.post('/orders/:id/review', ...guestOrderMutation, order.review);
guestRoutes.post('/orders/:id/cancel-requests', ...guestOrderMutation, cancelRequest.create);

guestRoutes.get('/receipts/current', loadReceiptGuest, currentReceipt);
guestRoutes.post(
  '/receipts/orders/:id/review',
  guestCsrfGuard,
  guestMutationLimiter,
  loadReceiptGuest,
  order.review,
);

guestRoutes.post(
  '/service-requests',
  loadGuest,
  guestCsrfGuard,
  guestServiceLimiter,
  requireGuest,
  serviceRequest.create,
);

const aiCustomer = [aiLimiter, loadGuest, guestCsrfGuard, requireAiCustomer];
guestRoutes.post('/ai/recommendations', ...aiCustomer, ai.recommend);
guestRoutes.post('/ai/recommendations/validate', ...aiCustomer, ai.validateConfiguration);
