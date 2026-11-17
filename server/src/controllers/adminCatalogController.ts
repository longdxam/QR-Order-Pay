import type { Request, Response, NextFunction } from 'express';
import {
  listAdminCategories,
  listAdminProducts,
  listAdminToppings,
  listStaffAvailability,
} from '../services/menuService.js';
import { ValidationError } from '../errors/AppError.js';
import * as catalogMutation from '../services/catalogMutationService.js';
import { availabilityRequestSchema } from '@may-cafe/contracts';

/** Danh mục, món, topping và trạng thái còn/hết món. */
export async function listProducts(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const products = await listAdminProducts();
    res.json({ success: true, data: { products } });
  } catch (e) {
    next(e);
  }
}

export async function listCategories(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const categories = await listAdminCategories();
    res.json({ success: true, data: { categories } });
  } catch (e) {
    next(e);
  }
}

export async function listToppings(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const toppings = await listAdminToppings();
    res.json({ success: true, data: { toppings } });
  } catch (e) {
    next(e);
  }
}

export async function staffAvailabilityCatalog(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json({ success: true, data: await listStaffAvailability() });
  } catch (error) {
    next(error);
  }
}

export async function setProductAvailability(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = availabilityRequestSchema.parse(req.body);
    const product = await catalogMutation.setProductAvailability(
      String(req.params['id'] ?? ''),
      input.isAvailable,
      req.user!.id,
    );
    res.json({ success: true, data: { product } });
  } catch (error) {
    next(error);
  }
}

export async function setVariantAvailability(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = availabilityRequestSchema.parse(req.body);
    const product = await catalogMutation.setVariantAvailability(
      String(req.params['id'] ?? ''),
      String(req.params['variantId'] ?? ''),
      input.isAvailable,
      req.user!.id,
    );
    res.json({ success: true, data: { product } });
  } catch (error) {
    next(error);
  }
}

export async function setToppingAvailability(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = availabilityRequestSchema.parse(req.body);
    const topping = await catalogMutation.setToppingAvailability(
      String(req.params['id'] ?? ''),
      input.isAvailable,
      req.user!.id,
    );
    res.json({ success: true, data: { topping } });
  } catch (error) {
    next(error);
  }
}

export async function createProduct(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = req.body as Record<string, unknown>;
    if (!body.name || !body.categoryId || !body.image)
      throw new ValidationError('Thiếu trường bắt buộc.');
    const product = await catalogMutation.createProduct(
      {
        ...body,
        variants: body.variants ?? [],
        allowedOptions: body.allowedOptions ?? {
          sizes: [],
          sugarLevels: [],
          iceLevels: [],
          toppingIds: [],
        },
        tags: body.tags ?? [],
        toppingIds: body.toppingIds ?? [],
        ingredientMetadata: body.ingredientMetadata ?? {},
        isAvailable: body.isAvailable ?? true,
        isArchived: false,
        isFeatured: body.isFeatured ?? false,
        sortOrder: body.sortOrder ?? 0,
      },
      req.user!.id,
    );
    res.status(201).json({ success: true, data: { product } });
  } catch (e) {
    next(e);
  }
}

export async function updateProduct(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = String(req.params['id'] ?? '');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const product = await catalogMutation.updateProduct(id, body, req.user!.id);
    if (!product) {
      res
        .status(404)
        .json({ success: false, error: { code: 'NOT_FOUND', message: 'Không tìm thấy món.' } });
      return;
    }
    res.json({ success: true, data: { product } });
  } catch (e) {
    next(e);
  }
}

export async function deleteProduct(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = String(req.params['id'] ?? '');
    const product = await catalogMutation.archiveProduct(id, req.user!.id);
    res.json({ success: true, data: { product } });
  } catch (e) {
    next(e);
  }
}

export async function createCategory(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = req.body as { name?: string; slug?: string; sortOrder?: number };
    if (!body.name || !body.slug) throw new ValidationError('Thiếu tên hoặc slug.');
    const created = await catalogMutation.createCategory(
      { name: body.name, slug: body.slug, sortOrder: body.sortOrder ?? 0 },
      req.user!.id,
    );
    res.status(201).json({ success: true, data: { category: created } });
  } catch (e) {
    next(e);
  }
}

export async function updateCategory(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = String(req.params['id'] ?? '');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const updated = await catalogMutation.updateCategory(id, body, req.user!.id);
    if (!updated) {
      res.status(404).json({
        success: false,
        error: { code: 'CATEGORY_NOT_FOUND', message: 'Không tìm thấy danh mục.' },
      });
      return;
    }
    res.json({ success: true, data: { category: updated } });
  } catch (e) {
    next(e);
  }
}

export async function deleteCategory(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const category = await catalogMutation.deleteCategory(
      String(req.params['id'] ?? ''),
      req.body?.reassignTo,
      req.user!.id,
    );
    res.json({ success: true, data: { category } });
  } catch (error) {
    next(error);
  }
}

export async function deleteTopping(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json({
      success: true,
      data: {
        topping: await catalogMutation.archiveTopping(String(req.params['id'] ?? ''), req.user!.id),
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function createTopping(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = req.body as { name?: string; price?: number; isAvailable?: boolean };
    if (!body.name || typeof body.price !== 'number')
      throw new ValidationError('Thiếu tên hoặc giá topping.');
    const created = await catalogMutation.createTopping(
      { name: body.name, price: body.price, isAvailable: body.isAvailable ?? true },
      req.user!.id,
    );
    res.status(201).json({ success: true, data: { topping: created } });
  } catch (e) {
    next(e);
  }
}

export async function updateTopping(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = String(req.params['id'] ?? '');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const topping = await catalogMutation.updateTopping(id, body, req.user!.id);
    res.json({ success: true, data: { topping } });
  } catch (e) {
    next(e);
  }
}
