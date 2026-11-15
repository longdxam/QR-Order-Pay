import { Router } from 'express';
import * as workforce from '../controllers/workforceController.js';
import { adminOnly, staffOnly } from './guards.js';

/** Lịch ca, chấm công và bảng công. */
export const workforceRoutes = Router();

workforceRoutes.get('/staff/workforce', ...staffOnly, workforce.staffWeek);
workforceRoutes.get('/staff/workforce/export', ...staffOnly, workforce.exportCsv(false));
workforceRoutes.get('/admin/workforce/export', ...adminOnly, workforce.exportCsv(true));
workforceRoutes.post('/admin/workforce/copy-preview', ...adminOnly, workforce.copyPreview);
workforceRoutes.post('/admin/workforce/copy', ...adminOnly, workforce.copy);
workforceRoutes.post('/staff/workforce/:id/clock-in', ...staffOnly, workforce.clockIn);
workforceRoutes.post('/staff/workforce/:id/clock-out', ...staffOnly, workforce.clockOut);
workforceRoutes.get('/admin/workforce', ...adminOnly, workforce.adminWeek);
workforceRoutes.post('/admin/workforce/shifts', ...adminOnly, workforce.create);
workforceRoutes.patch('/admin/workforce/shifts/:id', ...adminOnly, workforce.update);
workforceRoutes.post('/admin/workforce/shifts/:id/cancel', ...adminOnly, workforce.cancel);
workforceRoutes.post('/admin/workforce/shifts/:id/attendance', ...adminOnly, workforce.correction);
workforceRoutes.put('/admin/workforce/policy', ...adminOnly, workforce.policy);
