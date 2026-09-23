import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { apiRouter } from './routes/index.js';
import { errorHandler, notFound, requestId } from './middlewares/error.js';
import { logger } from './infrastructure/logger.js';
import { config } from './config/index.js';
import { checkMongoReadiness } from './infrastructure/mongo.js';
import { getRouteTemplate, httpMetrics, renderMetrics, setDependencyReadiness } from './infrastructure/metrics.js';
import { isRedisReady } from './infrastructure/redis.js';

interface BuildAppOptions {
  readinessProbe?: () => Promise<boolean>;
  redisReadinessProbe?: () => boolean;
}

export function buildApp(options: BuildAppOptions = {}): express.Express {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxyHops > 0) app.set('trust proxy', config.trustProxyHops);
  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = (res.getHeader('x-request-id') as string) ?? '';
        return id;
      },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      customSuccessObject: (req, _res, value) => ({
        ...value,
        requestId: req.id,
        method: req.method,
        route: getRouteTemplate(req),
      }),
      customErrorObject: (req, _res, error, value) => ({
        ...value,
        err: error,
        requestId: req.id,
        method: req.method,
        route: getRouteTemplate(req),
      }),
    }),
  );
  app.use(httpMetrics);
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(
    cors({
      origin: config.allowedOrigins,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());
  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', instanceId: config.instanceId });
  });
  app.get('/readyz', async (_req, res) => {
    let mongoReady = false;
    try {
      mongoReady = await (options.readinessProbe ?? checkMongoReadiness)();
    } catch {
      mongoReady = false;
    }
    setDependencyReadiness('mongodb', mongoReady);
    const redisReady = (options.redisReadinessProbe ?? isRedisReady)();
    setDependencyReadiness('redis', redisReady);
    res.status(mongoReady ? 200 : 503).json({
      status: mongoReady ? (redisReady ? 'ready' : 'degraded') : 'not_ready',
      instanceId: config.instanceId,
      dependencies: {
        mongodb: mongoReady ? 'ready' : 'unavailable',
        redis: redisReady ? 'ready' : 'unavailable',
      },
    });
  });
  app.get('/metrics', async (_req, res, next) => {
    try {
      const metrics = await renderMetrics();
      res.type(metrics.contentType).send(metrics.body);
    } catch (error) {
      next(error);
    }
  });
  app.use('/api/v1', apiRouter);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
