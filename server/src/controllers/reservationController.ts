import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { MEMBER_COOKIE, requireMember } from '../services/memberService.js';
import * as reservations from '../services/reservationService.js';

function handler(
  staff: boolean,
  work: (req: Request, actor: { staff: boolean; id: string }) => Promise<unknown>,
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = {
        staff,
        id: staff ? req.user!.id : (await requireMember(req.cookies?.[MEMBER_COOKIE])).id,
      };
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, data: await work(req, actor) });
    } catch (error) {
      next(error);
    }
  };
}

export const availability = (staff: boolean) =>
  handler(staff, (req) => reservations.reservationAvailability(req.query));
export const list = (staff: boolean) =>
  handler(staff, (req, a) => reservations.listReservations(a, req.query));
export const create = (staff: boolean) =>
  handler(staff, (req, a) => reservations.createReservation(a, req.body));
export const action = (staff: boolean, kind: 'cancel' | 'check-in') =>
  handler(staff, (req, a) =>
    reservations.actOnReservation(
      a,
      z
        .string()
        .regex(/^[a-f\d]{24}$/i)
        .parse(req.params['id']),
      kind,
      req.body,
    ),
  );
