import type { Request, Response, NextFunction } from 'express';
import { tableRepository } from '../repositories/tableRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { reviewRepository } from '../repositories/reviewRepository.js';
import { createAccount, editAccount, deleteEmployee } from '../services/accountService.js';
import { parseDate, parseRating, parsePositiveInt } from './queryParsers.js';

/** Bàn, tài khoản nhân viên và đánh giá của khách. */
export async function listTables(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tables = await tableRepository.list();
    res.json({ success: true, data: { tables } });
  } catch (e) {
    next(e);
  }
}

export async function listUsers(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const users = await userRepository.list({ isDeleted: { $ne: true } });
    res.json({
      success: true,
      data: {
        users: users.map((u) => ({
          id: u._id.toString(),
          name: u.name,
          email: u.email,
          role: u.role,
          isActive: u.isActive,
          createdAt: u.createdAt,
        })),
      },
    });
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

export async function createStaff(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res
      .status(201)
      .json({ success: true, data: { user: await createAccount(req.body, req.user!.id) } });
  } catch (error) {
    next(error);
  }
}

export async function updateUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({
      success: true,
      data: { user: await editAccount(String(req.params['id'] ?? ''), req.body, req.user!.id) },
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({
      success: true,
      data: await deleteEmployee(String(req.params['id'] ?? ''), req.user!.id),
    });
  } catch (error) {
    next(error);
  }
}
