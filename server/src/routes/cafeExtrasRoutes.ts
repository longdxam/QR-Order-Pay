import { Router } from 'express';
import * as cupPhotos from '../controllers/cupPhotoController.js';
import * as jukebox from '../controllers/jukeboxController.js';
import { guestCsrfGuard, loadGuest, requireGuest } from '../middlewares/guest.js';
import { portalPrefixes } from './guards.js';
import { rateLimitOrPassthrough, tableKey } from './rateLimits.js';

/** Ảnh in cốc/latte art và Jukebox — dùng chung cho khách tại bàn và Staff/Admin. */
export const cafeExtrasRoutes = Router();

// Một limiter dùng chung cho mọi đường tải ảnh/tạo latte art, kể cả của Staff.
const photoLimiter = rateLimitOrPassthrough(5, 'cup-photo-upload', tableKey);
cafeExtrasRoutes.get(
  '/cup-photos/:id/details',
  loadGuest,
  requireGuest,
  cupPhotos.authorize('guest'),
  cupPhotos.details,
);
cafeExtrasRoutes.post(
  '/cup-photos/:id/latte-art',
  loadGuest,
  requireGuest,
  guestCsrfGuard,
  photoLimiter,
  cupPhotos.authorize('guest'),
  cupPhotos.latteArt,
);
cafeExtrasRoutes.post(
  '/cup-photos',
  loadGuest,
  requireGuest,
  guestCsrfGuard,
  photoLimiter,
  cupPhotos.authorize('guest'),
  cupPhotos.rawUpload,
  cupPhotos.upload,
);
cafeExtrasRoutes.get(
  '/cup-photos/:id',
  loadGuest,
  requireGuest,
  cupPhotos.authorize('guest'),
  cupPhotos.own,
);

for (const { prefix: portal, guard } of portalPrefixes) {
  const prefix = `${portal}/cup-photos`;
  cafeExtrasRoutes.use(prefix, ...guard);
  cafeExtrasRoutes.post(
    prefix,
    photoLimiter,
    cupPhotos.authorize('staff'),
    cupPhotos.rawUpload,
    cupPhotos.upload,
  );
  cafeExtrasRoutes.get(`${prefix}/:id`, cupPhotos.authorize('staff'), cupPhotos.own);
  cafeExtrasRoutes.get(`${prefix}/:id/details`, cupPhotos.authorize('staff'), cupPhotos.details);
  cafeExtrasRoutes.post(
    `${prefix}/:id/latte-art`,
    photoLimiter,
    cupPhotos.authorize('staff'),
    cupPhotos.latteArt,
  );
}
for (const { prefix: portal, guard } of portalPrefixes) {
  const prefix = `${portal}/cup-prints`;
  cafeExtrasRoutes.use(prefix, ...guard);
  cafeExtrasRoutes.get(prefix, cupPhotos.feed);
  cafeExtrasRoutes.get(`${prefix}/:id/:index/image`, cupPhotos.image);
  cafeExtrasRoutes.post(prefix, cupPhotos.print);
  cafeExtrasRoutes.post(`${prefix}/latte-art/exports`, cupPhotos.exportLatteArt);
}

cafeExtrasRoutes.get('/jukebox', loadGuest, requireGuest, jukebox.feed);
cafeExtrasRoutes.post(
  '/jukebox/vote',
  loadGuest,
  requireGuest,
  guestCsrfGuard,
  rateLimitOrPassthrough(20, 'table-jukebox', tableKey),
  jukebox.vote,
);
// `use(prefix, guard)` cũng bảo vệ `/admin/jukebox/tracks` bên dưới.
for (const { prefix: portal, guard } of portalPrefixes) {
  const prefix = `${portal}/jukebox`;
  cafeExtrasRoutes.use(prefix, ...guard);
  cafeExtrasRoutes.get(prefix, jukebox.staffFeed);
  for (const kind of ['claim', 'heartbeat', 'release'] as const)
    cafeExtrasRoutes.post(`${prefix}/${kind}`, jukebox.lease(kind));
  for (const kind of ['next', 'stop', 'play'] as const)
    cafeExtrasRoutes.post(`${prefix}/${kind}`, jukebox.control(kind));
}
cafeExtrasRoutes.get('/admin/jukebox/tracks', jukebox.catalog);
cafeExtrasRoutes.post('/admin/jukebox/tracks', jukebox.saveTrack);
cafeExtrasRoutes.put('/admin/jukebox/tracks/:id', jukebox.saveTrack);
