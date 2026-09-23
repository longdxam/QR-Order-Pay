import type { Request, Response, NextFunction } from 'express';
import { menuSearchRequestSchema, menuSearchResponseSchema } from '@may-cafe/contracts';
import { searchMenu } from '../services/menuSearchService.js';
import { listPublicMenu, listFeatured } from '../services/menuService.js';

export async function listMenu(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await listPublicMenu();
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
}

export async function listFeaturedMenu(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const limit = Number(req.query.limit ?? 6);
    const items = await listFeatured(Number.isFinite(limit) ? limit : 6);
    res.json({ success: true, data: { items } });
  } catch (e) {
    next(e);
  }
}

export async function search(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = menuSearchRequestSchema.parse(req.body);
    const data = menuSearchResponseSchema.parse(await searchMenu(input));
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
}
