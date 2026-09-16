import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../errors/AppError.js';
import { logger } from '../infrastructure/logger.js';

export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && incoming.length > 0 ? incoming : cryptoRandom();
  res.setHeader('x-request-id', id);
  (req as unknown as { requestId: string }).requestId = id;
  next();
};

function cryptoRandom(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = (req as unknown as { requestId?: string }).requestId ?? '';
  if (err?.code === 11000) {
    res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Yêu cầu đã được ghi nhận hoặc dữ liệu bị trùng. Vui lòng tải lại.' }, requestId });
    return;
  }
  if (err?.name === 'CastError' || err?.name === 'ValidationError') {
    res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Dữ liệu không hợp lệ.' }, requestId });
    return;
  }
  if (err instanceof ZodError) {
    res.status(422).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Dữ liệu chưa hợp lệ.', details: err.flatten() },
      requestId,
    });
    return;
  }
  if (err instanceof AppError) {
    res.status(err.status).json({
      success: false,
      error: { code: err.code, message: err.message, details: err.details },
      requestId,
    });
    return;
  }
  logger.error({ err, requestId }, 'unhandled error');
  res.status(500).json({
    success: false,
    error: { code: 'INTERNAL', message: 'Đã xảy ra lỗi, vui lòng thử lại.' },
    requestId,
  });
};

export const notFound: RequestHandler = (req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'API không tồn tại.' },
    requestId: (req as unknown as { requestId?: string }).requestId ?? '',
  });
};
