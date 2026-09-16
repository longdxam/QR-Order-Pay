import { Router } from 'express';
import * as auth from '../controllers/authController.js';
import * as menu from '../controllers/menuController.js';
import * as tableSession from '../controllers/tableSessionController.js';
import * as order from '../controllers/orderController.js';
import * as payment from '../controllers/paymentController.js';
import * as ai from '../controllers/aiController.js';
import * as serviceRequest from '../controllers/serviceRequestController.js';
import * as admin from '../controllers/adminController.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import { loadGuest, loadReceiptGuest, requireGuest, guestCsrfGuard } from '../middlewares/guest.js';
import { currentReceipt } from '../controllers/receiptController.js';
import { rateLimit as expressRateLimit } from 'express-rate-limit';

export const apiRouter = Router();

const authLimiter = expressRateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false });
const guestMutationLimiter = expressRateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false });

// auth
apiRouter.post('/auth/login', authLimiter, auth.login);
apiRouter.post('/auth/refresh', authLimiter, auth.refresh);
apiRouter.post('/auth/logout', authLimiter, auth.logout);
apiRouter.post('/auth/logout-all', authLimiter, requireAuth, auth.logoutAll);
apiRouter.get('/auth/me', requireAuth, auth.me);

// public menu
apiRouter.get('/categories', menu.listMenu);
apiRouter.get('/products', menu.listMenu);
apiRouter.get('/products/featured', menu.listFeaturedMenu);

// table session public + guest
apiRouter.post('/table-sessions/join', loadGuest, guestCsrfGuard, tableSession.join);
apiRouter.get('/table-sessions/current', loadGuest, tableSession.current);
apiRouter.post('/table-sessions/leave', loadGuest, guestCsrfGuard, tableSession.leave);

// guest orders
apiRouter.post('/orders', loadGuest, guestCsrfGuard, guestMutationLimiter, requireGuest, order.place);
apiRouter.get('/orders/mine', loadGuest, requireGuest, order.listMine);
apiRouter.get('/orders/:id', loadGuest, requireGuest, order.detail);
apiRouter.post('/orders/:id/cancel', loadGuest, guestCsrfGuard, requireGuest, order.cancel);
apiRouter.post('/orders/:id/review', loadGuest, guestCsrfGuard, requireGuest, order.review);
apiRouter.get('/receipts/current', loadReceiptGuest, currentReceipt);
apiRouter.post('/receipts/orders/:id/review', guestCsrfGuard, guestMutationLimiter, loadReceiptGuest, order.review);

// guest service requests
apiRouter.post('/service-requests', loadGuest, guestCsrfGuard, requireGuest, serviceRequest.create);

// AI
apiRouter.post('/ai/recommendations', loadGuest, guestCsrfGuard, requireGuest, ai.recommend);

// staff/admin
apiRouter.get('/staff/tables', requireAuth, requireRole('STAFF', 'ADMIN'), tableSession.staffTables);
apiRouter.get('/staff/orders', requireAuth, requireRole('STAFF', 'ADMIN'), order.staffList);
apiRouter.patch('/staff/orders/:id/status', requireAuth, requireRole('STAFF', 'ADMIN'), order.staffTransition);
apiRouter.post('/staff/orders/:id/confirm', requireAuth, requireRole('STAFF', 'ADMIN'), order.staffConfirmReceipt);

apiRouter.get('/staff/table-sessions', requireAuth, requireRole('STAFF', 'ADMIN'), tableSession.staffList);
apiRouter.post('/staff/tables/:tableId/sessions', requireAuth, requireRole('STAFF', 'ADMIN'), tableSession.staffOpen);
apiRouter.patch('/staff/table-sessions/:id/status', requireAuth, requireRole('STAFF', 'ADMIN'), tableSession.staffTransition);
apiRouter.get('/staff/table-sessions/:id/bill', requireAuth, requireRole('STAFF', 'ADMIN'), tableSession.staffBill);

apiRouter.post('/staff/table-sessions/:id/payments', requireAuth, requireRole('STAFF', 'ADMIN'), payment.confirm);
apiRouter.get('/staff/service-requests', requireAuth, requireRole('STAFF', 'ADMIN'), serviceRequest.list);
apiRouter.post('/staff/service-requests/:id/resolve', requireAuth, requireRole('STAFF', 'ADMIN'), serviceRequest.resolveOne);

// admin
apiRouter.get('/admin/reports/overview', requireAuth, requireRole('ADMIN'), admin.reportsOverview);
apiRouter.get('/admin/products', requireAuth, requireRole('ADMIN'), admin.listProducts);
apiRouter.post('/admin/products', requireAuth, requireRole('ADMIN'), admin.createProduct);
apiRouter.patch('/admin/products/:id', requireAuth, requireRole('ADMIN'), admin.updateProduct);
apiRouter.delete('/admin/products/:id', requireAuth, requireRole('ADMIN'), admin.deleteProduct);

apiRouter.get('/admin/categories', requireAuth, requireRole('ADMIN'), admin.listCategories);
apiRouter.post('/admin/categories', requireAuth, requireRole('ADMIN'), admin.createCategory);

apiRouter.get('/admin/toppings', requireAuth, requireRole('ADMIN'), admin.listToppings);
apiRouter.post('/admin/toppings', requireAuth, requireRole('ADMIN'), admin.createTopping);
apiRouter.patch('/admin/toppings/:id', requireAuth, requireRole('ADMIN'), admin.updateTopping);

apiRouter.get('/admin/tables', requireAuth, requireRole('ADMIN'), admin.listTables);
apiRouter.post('/admin/tables/:id/rotate-token', requireAuth, requireRole('ADMIN'), admin.rotateTableToken);
apiRouter.get('/admin/users', requireAuth, requireRole('ADMIN'), admin.listUsers);
apiRouter.get('/admin/reviews', requireAuth, requireRole('ADMIN'), admin.listReviews);

// health
apiRouter.get('/health', (_req, res) => {
  res.json({ success: true, data: { ok: true, uptime: process.uptime() } });
});
