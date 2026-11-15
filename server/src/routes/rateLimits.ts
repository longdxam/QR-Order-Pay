import type { RequestHandler } from 'express';
import { rateLimit as expressRateLimit } from 'express-rate-limit';
import { config } from '../config/index.js';
import { createRateLimitStore } from '../infrastructure/redis.js';
import { sha256 } from '../utils/crypto.js';

type Req = Parameters<RequestHandler>[0];

// Rate limit là biện pháp bảo vệ production; trong test (NODE_ENV=test) nó bị vô hiệu theo cùng cách
// morgan bị tắt ở app.ts, vì mọi request của bộ test đến từ cùng một IP và sẽ chạm trần một cách giả tạo.
// Limiter được tạo lười ở request đầu tiên để import route không cần Redis. Tên hàm `rateLimit:<prefix>`
// giúp đọc stack trace và cho test ma trận route kiểm đúng limiter.
export function rateLimitOrPassthrough(
  max: number,
  prefix: string,
  keyGenerator?: (req: Req) => string,
): RequestHandler {
  const named = (handler: RequestHandler): RequestHandler =>
    Object.defineProperty(handler, 'name', { value: `rateLimit:${prefix}` });
  if (config.env === 'test') return named((_req, _res, next) => next());
  let limiter: RequestHandler | null = null;
  return named((req, res, next) => {
    try {
      limiter ??= expressRateLimit({
        windowMs: 60_000,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        store: createRateLimitStore(prefix),
        passOnStoreError: false,
        keyGenerator,
        handler: (_req, res) => {
          res.status(429).json({
            success: false,
            error: {
              code: 'RATE_LIMITED',
              message: 'Bạn thao tác quá nhanh. Vui lòng chờ một chút rồi thử lại.',
            },
            requestId: res.getHeader('x-request-id'),
          });
        },
      });
      limiter(req, res, next);
    } catch (error) {
      next(error);
    }
  });
}

const clientIpKey = (req: Req): string => `ip:${sha256(req.ip ?? 'unknown')}`;

/** Hạn mức theo phiên bàn khi khách đã vào bàn, nếu chưa thì theo IP (đã băm). */
export const tableKey = (req: Req): string =>
  req.guest?.tableSessionId ? `table:${req.guest.tableSessionId}` : clientIpKey(req);

const joinKey = (req: Req): string => {
  const tableToken = (req.body as { tableToken?: unknown } | undefined)?.tableToken;
  return typeof tableToken === 'string' && tableToken.length > 0
    ? `table-token:${sha256(tableToken)}`
    : clientIpKey(req);
};

const limits = config.rateLimits;
export const authLimiter = rateLimitOrPassthrough(limits.authPerMinute, 'auth');
export const guestMutationLimiter = rateLimitOrPassthrough(
  limits.guestMutationPerMinute,
  'guest-mutation',
);
export const guestJoinLimiter = rateLimitOrPassthrough(
  limits.guestJoinPerMinute,
  'guest-join',
  joinKey,
);
export const guestOrderLimiter = rateLimitOrPassthrough(
  limits.guestOrderPerMinute,
  'guest-order',
  tableKey,
);
export const guestQuoteLimiter = rateLimitOrPassthrough(
  limits.guestQuotePerMinute,
  'guest-quote',
  tableKey,
);
export const guestServiceLimiter = rateLimitOrPassthrough(
  limits.guestServicePerMinute,
  'guest-service',
  tableKey,
);
export const aiLimiter = rateLimitOrPassthrough(limits.aiPerMinute, 'ai');
