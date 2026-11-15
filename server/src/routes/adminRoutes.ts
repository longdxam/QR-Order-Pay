import { Router } from 'express';
import * as admin from '../controllers/adminController.js';
import * as inventory from '../controllers/inventoryController.js';
import * as tableDisplay from '../controllers/tableDisplayController.js';
import { adminOnly } from './guards.js';

/** Quản trị: kho, báo cáo, hóa đơn, vận hành hệ thống, bàn, nhân viên và đánh giá. */
export const adminRoutes = Router();

adminRoutes.get('/admin/inventory', ...adminOnly, inventory.overview);
adminRoutes.post('/admin/inventory/ingredients', ...adminOnly, inventory.createIngredient);
adminRoutes.patch('/admin/inventory/ingredients/:id', ...adminOnly, inventory.updateIngredient);
adminRoutes.post('/admin/inventory/ingredients/:id/movements', ...adminOnly, inventory.moveStock);
adminRoutes.get('/admin/inventory/movements', ...adminOnly, inventory.movements);
adminRoutes.put('/admin/inventory/recipes/:type/:id', ...adminOnly, inventory.saveRecipe);

adminRoutes.get('/admin/reports/overview', ...adminOnly, admin.reportsOverview);
adminRoutes.post('/admin/reports/overview/jobs', ...adminOnly, admin.createOverviewJob);
adminRoutes.get('/admin/reports/jobs/:id', ...adminOnly, admin.reportJobStatus);
adminRoutes.get('/admin/bills', ...adminOnly, admin.bills);
adminRoutes.get('/admin/bills/:id', ...adminOnly, admin.billDetail);

adminRoutes.get('/admin/operations/summary', ...adminOnly, admin.operations);
adminRoutes.get('/admin/operations/failures', ...adminOnly, admin.operationFailures);
adminRoutes.post('/admin/operations/outbox/:id/replay', ...adminOnly, admin.replayOutbox);
adminRoutes.post('/admin/operations/jobs/:id/replay', ...adminOnly, admin.replayQueueJob);
adminRoutes.get('/admin/anomalies', ...adminOnly, admin.anomalies);
adminRoutes.patch('/admin/anomalies/:id/status', ...adminOnly, admin.setAnomalyStatus);

adminRoutes.get('/admin/tables', ...adminOnly, admin.listTables);
adminRoutes.post('/admin/tables/:id/rotate-token', ...adminOnly, tableDisplay.provision);
adminRoutes.get('/admin/users', ...adminOnly, admin.listUsers);
adminRoutes.post('/admin/users', ...adminOnly, admin.createStaff);
adminRoutes.patch('/admin/users/:id', ...adminOnly, admin.updateUser);
adminRoutes.delete('/admin/users/:id', ...adminOnly, admin.deleteUser);
adminRoutes.get('/admin/reviews', ...adminOnly, admin.listReviews);
