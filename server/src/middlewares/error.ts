import type { ErrorRequestHandler, RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { AppError } from '../errors/AppError.js';
import { logger } from '../infrastructure/logger.js';

// requestId do client gửi chỉ được dùng khi an toàn: ký tự giới hạn, độ dài tối đa 64.
// Ngoài phạm vi này server tự sinh UUID để log không bị bẩn và metrics không bị phình nhãn.
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', id);
  (req as unknown as { requestId: string }).requestId = id;
  next();
};

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
