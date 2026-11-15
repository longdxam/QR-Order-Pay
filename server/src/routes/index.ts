import { Router } from 'express';
import { config } from '../config/index.js';
import { NotFoundError } from '../errors/AppError.js';
import { accountRoutes } from './accountRoutes.js';
import { adminRoutes } from './adminRoutes.js';
import { cafeExtrasRoutes } from './cafeExtrasRoutes.js';
import { guestRoutes } from './guestRoutes.js';
import { menuRoutes } from './menuRoutes.js';
import { paymentRoutes } from './paymentRoutes.js';
import { reservationRoutes } from './reservationRoutes.js';
import { serviceFloorRoutes } from './serviceFloorRoutes.js';
import { workforceRoutes } from './workforceRoutes.js';

export const apiRouter = Router();

// Instance `guest` chỉ phục vụ API khách, instance `internal` chỉ phục vụ /auth, /staff, /admin.
apiRouter.use(function trafficClassGuard(req, _res, next) {
  if (config.trafficClass === 'unified') return next();
  if (/^\/health(?:\/|$)/.test(req.path)) return next();
  const internalRoute = /^\/(?:auth|staff|admin)(?:\/|$)/.test(req.path);
  if (config.trafficClass === 'guest' && internalRoute) return next(new NotFoundError());
  if (config.trafficClass === 'internal' && !internalRoute) return next(new NotFoundError());
  next();
});

// Mỗi router con dùng đường dẫn đầy đủ và được mount ở gốc. Quyền truy cập của từng route được
// kiểm bởi src/__tests__/unit/routeAuthorization.test.ts.
apiRouter.use(reservationRoutes);
apiRouter.use(accountRoutes);
apiRouter.use(menuRoutes);
apiRouter.use(guestRoutes);
apiRouter.use(cafeExtrasRoutes);
apiRouter.use(workforceRoutes);
apiRouter.use(paymentRoutes);
apiRouter.use(serviceFloorRoutes);
apiRouter.use(adminRoutes);

apiRouter.get('/health', (_req, res) => {
  res.json({
    success: true,
    data: {
      ok: true,
      uptime: process.uptime(),
      instanceId: config.instanceId,
      trafficClass: config.trafficClass,
    },
  });
});
