import { Router } from 'express';
import * as cashShift from '../controllers/cashShiftController.js';
import * as payment from '../controllers/paymentController.js';
import { adminOnly, staffOnly } from './guards.js';

/** Thu tiền từng đơn, hoàn tiền, điều chỉnh khoản thu và ca thu ngân. */
export const paymentRoutes = Router();

paymentRoutes.get('/staff/payments', ...staffOnly, payment.accounting);
paymentRoutes.post('/staff/payments/:id/corrections', ...staffOnly, payment.requestCorrection);
paymentRoutes.get('/admin/payments', ...adminOnly, payment.accounting);
paymentRoutes.post('/admin/payments/:id/corrections', ...adminOnly, payment.requestCorrection);
paymentRoutes.post('/admin/payments/:id/corrections/apply', ...adminOnly, payment.applyCorrection);
paymentRoutes.post(
  '/admin/payment-corrections/:id/decision',
  ...adminOnly,
  payment.decideCorrection,
);
paymentRoutes.post('/staff/table-sessions/:id/payment-claim', ...staffOnly, payment.claim);
paymentRoutes.post(
  '/staff/table-sessions/:id/payment-claim/release',
  ...staffOnly,
  payment.releaseClaim,
);
paymentRoutes.get('/staff/awaiting-payments', ...staffOnly, payment.awaiting);
paymentRoutes.post('/staff/orders/:id/payments', ...staffOnly, payment.confirmOrder);
paymentRoutes.post('/staff/orders/:id/refund', ...staffOnly, payment.refundOrder);
paymentRoutes.post('/staff/table-sessions/:id/payments', ...staffOnly, payment.confirm);

paymentRoutes.get('/staff/cash-shifts/current', ...staffOnly, cashShift.current);
paymentRoutes.post('/staff/cash-shifts', ...staffOnly, cashShift.open);
paymentRoutes.post('/staff/cash-shifts/:id/close', ...staffOnly, cashShift.close);
paymentRoutes.get('/admin/cash-shifts', ...adminOnly, cashShift.history);
