import type { Request, Response, NextFunction } from 'express';
import { aiRecommendRequestSchema } from '@may-cafe/contracts';
import { buildAIService } from '../services/aiService.js';
import { RateLimitError } from '../errors/AppError.js';

const aiService = buildAIService();

// simple in-memory rate limit: 30 requests / 5 min per guest/ip
const RATE_WINDOW_MS = 5 * 60 * 1000;
const RATE_MAX = 30;
const buckets = new Map<string, number[]>();

function rateLimit(key: string): void {
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_MAX) throw new RateLimitError();
  arr.push(now);
  buckets.set(key, arr);
}

export async function recommend(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const guestKey = req.guest?.participantId ?? req.ip ?? 'anon';
    rateLimit(`ai:${guestKey}`);
    const input = aiRecommendRequestSchema.parse(req.body);
    const result = await aiService.recommend(input);
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
}
