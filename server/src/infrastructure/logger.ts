import pino from 'pino';
import { config } from '../config/index.js';

export const logger = pino({
  level: config.logLevel,
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]', '*.password', '*.token', '*.apiKey', '*.secret'],
    censor: '[REDACTED]',
  },
  base: { service: 'maycafe-server', instance: config.instanceId },
});

export type Logger = typeof logger;
