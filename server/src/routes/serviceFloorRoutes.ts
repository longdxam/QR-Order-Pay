import { Router } from 'express';
import * as cancelRequest from '../controllers/cancelRequestController.js';
import * as order from '../controllers/orderController.js';
import * as serviceRequest from '../controllers/serviceRequestController.js';
import * as tableDisplay from '../controllers/tableDisplayController.js';
import * as tableSession from '../controllers/tableSessionController.js';
import { adminOnly, staffOnly } from './guards.js';

/** Vận hành tại sàn: bàn & phiên, QR bàn, KDS, yêu cầu phục vụ và yêu cầu hủy. */
export const serviceFloorRoutes = Router();

serviceFloorRoutes.get('/staff/tables', ...staffOnly, tableSession.staffTables);
serviceFloorRoutes.get('/staff/tables/:id/qr', ...staffOnly, tableDisplay.staticQr);
serviceFloorRoutes.get('/admin/tables/:id/qr', ...adminOnly, tableDisplay.staticQr);
// Cấp lại khóa (làm QR in mất hiệu lực) chỉ dành cho ADMIN: không còn route /staff tương ứng.
serviceFloorRoutes.post('/admin/tables/:id/display', ...adminOnly, tableDisplay.provision);
serviceFloorRoutes.post('/staff/tables/:tableId/sessions', ...staffOnly, tableSession.staffOpen);

serviceFloorRoutes.get('/staff/orders', ...staffOnly, order.staffList);
serviceFloorRoutes.get('/staff/orders/:id', ...staffOnly, order.staffGetOne);
serviceFloorRoutes.patch('/staff/orders/:id/status', ...staffOnly, order.staffTransition);
serviceFloorRoutes.post('/staff/orders/:id/confirm', ...staffOnly, order.staffConfirmReceipt);

serviceFloorRoutes.get('/staff/table-sessions', ...staffOnly, tableSession.staffList);
serviceFloorRoutes.patch(
  '/staff/table-sessions/:id/status',
  ...staffOnly,
  tableSession.staffTransition,
);
serviceFloorRoutes.post(
  '/staff/table-sessions/:id/transfer',
  ...staffOnly,
  tableSession.staffTransfer,
);
serviceFloorRoutes.get('/staff/table-sessions/:id/bill', ...staffOnly, tableSession.staffBill);

serviceFloorRoutes.get('/staff/service-requests', ...staffOnly, serviceRequest.list);
serviceFloorRoutes.post(
  '/staff/service-requests/:id/resolve',
  ...staffOnly,
  serviceRequest.resolveOne,
);
serviceFloorRoutes.get('/staff/cancel-requests', ...staffOnly, cancelRequest.list);
serviceFloorRoutes.patch('/staff/cancel-requests/:id', ...staffOnly, cancelRequest.decide);
