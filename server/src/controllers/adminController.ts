import type { Request, Response, NextFunction } from 'express';
import { overview } from '../services/dashboardService.js';
import { listAdminCategories, listAdminProducts, listAdminToppings } from '../services/menuService.js';
import { tableRepository } from '../repositories/tableRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { ValidationError } from '../errors/AppError.js';
import { productRepository } from '../repositories/productRepository.js';
import { categoryRepository } from '../repositories/categoryRepository.js';
import { toppingRepository } from '../repositories/toppingRepository.js';
import { publishMenuChange } from '../realtime/socket.js';
import { reviewRepository } from '../repositories/reviewRepository.js';
import { hashPassword } from '../utils/crypto.js';

export async function reportsOverview(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    const data = await overview(from, to);
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
}

export async function listProducts(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const products = await listAdminProducts();
    res.json({ success: true, data: { products } });
  } catch (e) {
    next(e);
  }
}

export async function listCategories(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const categories = await listAdminCategories();
    res.json({ success: true, data: { categories } });
  } catch (e) {
    next(e);
  }
}

export async function listToppings(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const toppings = await listAdminToppings();
    res.json({ success: true, data: { toppings } });
  } catch (e) {
    next(e);
  }
}

export async function listTables(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tables = await tableRepository.list();
    res.json({ success: true, data: { tables } });
  } catch (e) {
    next(e);
  }
}

export async function rotateTableToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = String(req.params['id'] ?? '');
    const table = await tableRepository.findById(id);
    if (!table) {
      res.status(404).json({ success: false, error: { code: 'TABLE_NOT_FOUND', message: 'Không tìm thấy bàn.' } });
      return;
    }
    const newToken = (await import('../utils/crypto.js')).randomToken(24);
    const newHash = (await import('../utils/crypto.js')).sha256(newToken);
    await tableRepository.update(id, { publicTokenHash: newHash });
    const publicAppUrl = process.env['PUBLIC_APP_URL'] ?? 'http://localhost:5173';
    res.json({
      success: true,
      data: {
        tableId: id,
        publicToken: newToken,
        url: `${publicAppUrl}/t/${newToken}`,
      },
    });
  } catch (e) {
    next(e);
  }
}

export async function listUsers(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const users = await userRepository.list();
    res.json({ success: true, data: { users: users.map((u) => ({ id: u._id.toString(), name: u.name, email: u.email, role: u.role, isActive: u.isActive, createdAt: u.createdAt })) } });
  } catch (e) {
    next(e);
  }
}

export async function listReviews(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rating = parseRating(req.query.rating);
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to, true);
    const page = parsePositiveInt(req.query.page) ?? 1;
    const data = await reviewRepository.listForAdmin({ rating, from, to, page, limit: 20 });
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
}

export async function createProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as Record<string, unknown>;
    if (!body.name || !body.categoryId || !body.image) throw new ValidationError('Thiếu trường bắt buộc.');
    const product = await productRepository.create({
      ...body,
      variants: body.variants ?? [],
      allowedOptions: body.allowedOptions ?? { sizes: [], sugarLevels: [], iceLevels: [], toppingIds: [] },
      tags: body.tags ?? [],
      toppingIds: body.toppingIds ?? [],
      ingredientMetadata: body.ingredientMetadata ?? {},
      isAvailable: body.isAvailable ?? true,
      isArchived: false,
      isFeatured: body.isFeatured ?? false,
      sortOrder: body.sortOrder ?? 0,
    });
    res.status(201).json({ success: true, data: { product } });
    publishMenuChange();
  } catch (e) {
    next(e);
  }
}

export async function updateProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = String(req.params['id'] ?? '');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const product = await productRepository.update(id, body);
    if (!product) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Không tìm thấy món.' } });
      return;
    }
    res.json({ success: true, data: { product } });
    publishMenuChange();
  } catch (e) {
    next(e);
  }
}

export async function deleteProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = String(req.params['id'] ?? '');
    const product = await productRepository.archive(id);
    publishMenuChange();
    res.json({ success: true, data: { product } });
  } catch (e) {
    next(e);
  }
}

export async function createCategory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as { name?: string; slug?: string; sortOrder?: number };
    if (!body.name || !body.slug) throw new ValidationError('Thiếu tên hoặc slug.');
    const created = await categoryRepository.create({ name: body.name, slug: body.slug, sortOrder: body.sortOrder ?? 0 });
    res.status(201).json({ success: true, data: { category: created } });
  } catch (e) {
    next(e);
  }
}

export async function updateCategory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = String(req.params['id'] ?? '');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const updated = await categoryRepository.update(id, body);
    if (!updated) {
      res.status(404).json({ success: false, error: { code: 'CATEGORY_NOT_FOUND', message: 'Không tìm thấy danh mục.' } });
      return;
    }
    publishMenuChange();
    res.json({ success: true, data: { category: updated } });
  } catch (e) {
    next(e);
  }
}

export async function createStaff(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as { name?: string; email?: string; password?: string; role?: 'STAFF' | 'ADMIN' };
    if (!body.name || !body.email || !body.password) throw new ValidationError('Thiếu tên, email hoặc mật khẩu.');
    if (body.password.length < 8) throw new ValidationError('Mật khẩu tối thiểu 8 ký tự.');
    const existing = await userRepository.findByEmail(body.email);
    if (existing) {
      res.status(409).json({ success: false, error: { code: 'EMAIL_TAKEN', message: 'Email đã được sử dụng.' } });
      return;
    }
    const passwordHash = await hashPassword(body.password);
    const user = await userRepository.create({
      name: body.name,
      email: body.email,
      passwordHash,
      role: body.role ?? 'STAFF',
    });
    res.status(201).json({ success: true, data: { user: { id: user._id.toString(), name: user.name, email: user.email, role: user.role, isActive: user.isActive } } });
  } catch (e) {
    next(e);
  }
}

export async function updateUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = String(req.params['id'] ?? '');
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.password === 'string') {
      if (body.password.length < 8) throw new ValidationError('Mật khẩu tối thiểu 8 ký tự.');
      body.passwordHash = await hashPassword(body.password);
      delete body.password;
    }
    const updated = await userRepository.update(id, body);
    if (!updated) {
      res.status(404).json({ success: false, error: { code: 'USER_NOT_FOUND', message: 'Không tìm thấy nhân viên.' } });
      return;
    }
    res.json({
      success: true,
      data: { user: { id: updated._id.toString(), name: updated.name, email: updated.email, role: updated.role, isActive: updated.isActive } },
    });
  } catch (e) {
    next(e);
  }
}

export async function createTopping(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as { name?: string; price?: number; isAvailable?: boolean };
    if (!body.name || typeof body.price !== 'number') throw new ValidationError('Thiếu tên hoặc giá topping.');
    const created = await toppingRepository.create({ name: body.name, price: body.price, isAvailable: body.isAvailable ?? true });
    res.status(201).json({ success: true, data: { topping: created } });
  } catch (e) {
    next(e);
  }
}

export async function updateTopping(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = String(req.params['id'] ?? '');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const topping = await toppingRepository.update(id, body);
    publishMenuChange();
    res.json({ success: true, data: { topping } });
  } catch (e) {
    next(e);
  }
}

function parseDate(v: unknown, nextDay = false): Date | undefined {
  if (typeof v !== 'string') return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new ValidationError('Ngày không hợp lệ.');
  if (nextDay) d.setDate(d.getDate() + 1);
  return d;
}

function parseRating(v: unknown): number | undefined {
  if (v === undefined || v === '') return undefined;
  const rating = Number(v);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new ValidationError('Số sao phải từ 1 đến 5.');
  return rating;
}

function parsePositiveInt(v: unknown): number | undefined {
  if (v === undefined) return undefined;
  const number = Number(v);
  if (!Number.isInteger(number) || number < 1) throw new ValidationError('Trang không hợp lệ.');
  return number;
}
