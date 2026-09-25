import type { Request, Response, NextFunction } from 'express';
import {
  aiRecommendRequestSchema,
  validateAiConfigurationRequestSchema,
} from '@may-cafe/contracts';
import { buildAIService, validateRecommendedConfiguration } from '../services/aiService.js';

const aiService = buildAIService();

export async function recommend(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = aiRecommendRequestSchema.parse(req.body);
    const result = await aiService.recommend(input);
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
}

export async function validateConfiguration(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = validateAiConfigurationRequestSchema.parse(req.body);
    res.json({ success: true, data: await validateRecommendedConfiguration(input) });
  } catch (error) {
    next(error);
  }
}
