import { Router } from 'express';
import * as admin from '../controllers/adminController.js';
import * as ai from '../controllers/aiController.js';
import * as menu from '../controllers/menuController.js';
import { config } from '../config/index.js';
import { adminOnly, staffOnly } from './guards.js';
import { rateLimitOrPassthrough } from './rateLimits.js';

/** Thực đơn công khai, bật/tắt món của Staff và quản lý món/danh mục/topping của Admin. */
export const menuRoutes = Router();

menuRoutes.get('/categories', menu.listMenu);
menuRoutes.get('/products', menu.listMenu);
menuRoutes.get('/products/featured', menu.listFeaturedMenu);
menuRoutes.get('/products/best-sellers', menu.listBestSellers);
menuRoutes.post(
  '/menu/search',
  rateLimitOrPassthrough(config.rateLimits.menuSearchPerMinute, 'menu-search'),
  menu.search,
);

menuRoutes.get('/staff/catalog/availability', ...staffOnly, admin.staffAvailabilityCatalog);
menuRoutes.patch(
  '/staff/catalog/products/:id/availability',
  ...staffOnly,
  admin.setProductAvailability,
);
menuRoutes.patch(
  '/staff/catalog/products/:id/variants/:variantId/availability',
  ...staffOnly,
  admin.setVariantAvailability,
);
menuRoutes.patch(
  '/staff/catalog/toppings/:id/availability',
  ...staffOnly,
  admin.setToppingAvailability,
);

menuRoutes.get('/admin/products', ...adminOnly, admin.listProducts);
menuRoutes.post('/admin/products', ...adminOnly, admin.createProduct);
menuRoutes.post(
  '/admin/products/ai-tag-suggestions',
  ...adminOnly,
  rateLimitOrPassthrough(config.rateLimits.aiPerMinute, 'admin-ai-tags'),
  ai.suggestProductTags,
);
menuRoutes.patch('/admin/products/:id', ...adminOnly, admin.updateProduct);
menuRoutes.delete('/admin/products/:id', ...adminOnly, admin.deleteProduct);

menuRoutes.get('/admin/categories', ...adminOnly, admin.listCategories);
menuRoutes.post('/admin/categories', ...adminOnly, admin.createCategory);
menuRoutes.patch('/admin/categories/:id', ...adminOnly, admin.updateCategory);
menuRoutes.delete('/admin/categories/:id', ...adminOnly, admin.deleteCategory);

menuRoutes.get('/admin/toppings', ...adminOnly, admin.listToppings);
menuRoutes.post('/admin/toppings', ...adminOnly, admin.createTopping);
menuRoutes.patch('/admin/toppings/:id', ...adminOnly, admin.updateTopping);
menuRoutes.delete('/admin/toppings/:id', ...adminOnly, admin.deleteTopping);
