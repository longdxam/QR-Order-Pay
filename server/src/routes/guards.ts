import type { RequestHandler } from 'express';
import { requireAuth, requireRole } from '../middlewares/auth.js';

/** Nhân viên hoặc quản trị đã đăng nhập. Dùng: `router.get(path, ...staffOnly, handler)`. */
export const staffOnly: RequestHandler[] = [requireAuth, requireRole('STAFF', 'ADMIN')];

/** Chỉ quản trị đã đăng nhập. */
export const adminOnly: RequestHandler[] = [requireAuth, requireRole('ADMIN')];

/** Cùng một nhóm endpoint phục vụ cả `/staff/...` và `/admin/...` với quyền tương ứng. */
export const portalPrefixes = [
  { prefix: '/staff', guard: staffOnly },
  { prefix: '/admin', guard: adminOnly },
] as const;
