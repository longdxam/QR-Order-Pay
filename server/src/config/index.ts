import dotenv from 'dotenv';
import path from 'node:path';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });
dotenv.config({ path: path.resolve(here, '../.env') });

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const parsed = Number(v);
  if (Number.isNaN(parsed)) throw new Error(`Invalid number env ${name}=${v}`);
  return parsed;
}

function nonNegativeInt(name: string, fallback: number): number {
  const value = num(name, fallback);
  if (!Number.isInteger(value) || value < 0) throw new Error(`Invalid non-negative integer env ${name}=${value}`);
  return value;
}

function positiveInt(name: string, fallback: number): number {
  const value = nonNegativeInt(name, fallback);
  if (value === 0) throw new Error(`Invalid positive integer env ${name}=${value}`);
  return value;
}

function positiveNumber(name: string, fallback: number): number {
  const value = num(name, fallback);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid positive number env ${name}=${value}`);
  return value;
}

function fraction(name: string, fallback: number): number {
  const value = num(name, fallback);
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`Invalid fraction env ${name}=${value}`);
  return value;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return v === 'true' || v === '1';
}

const environment = required('NODE_ENV', 'development');
const publicAppUrl = required('PUBLIC_APP_URL', 'http://localhost:5173');
const serverOrigin = required('SERVER_ORIGIN', 'http://localhost:4000');
const staffAppUrl = required('STAFF_APP_URL', publicAppUrl);
const adminAppUrl = required('ADMIN_APP_URL', publicAppUrl);
const allowedOrigins = [...new Set([publicAppUrl, staffAppUrl, adminAppUrl, serverOrigin])];

function authSecret(name: string, developmentFallback: string): string {
  const value = required(name, developmentFallback);
  if (environment === 'production' && (value.length < 32 || /^(change-me|dev-)/i.test(value))) {
    throw new Error(`${name} must be at least 32 characters and must not use a development placeholder in production`);
  }
  return value;
}

export const config = {
  env: environment,
  port: num('PORT', 4000),
  trustProxyHops: nonNegativeInt('TRUST_PROXY_HOPS', 0),
  shutdownTimeoutMs: nonNegativeInt('SHUTDOWN_TIMEOUT_MS', 10_000),
  publicAppUrl,
  staffAppUrl,
  adminAppUrl,
  serverOrigin,
  allowedOrigins,
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,
  cookieSecure: bool('COOKIE_SECURE', false),
  logLevel: required('LOG_LEVEL', 'info'),
  instanceId: process.env.INSTANCE_ID?.trim() || hostname(),
  mongoUri: required('MONGODB_URI', 'mongodb://127.0.0.1:27017/maycafe?replicaSet=rs0&directConnection=true'),
  redisUrl: required('REDIS_URL', 'redis://127.0.0.1:6379'),
  rateLimits: {
    authPerMinute: positiveInt('RATE_LIMIT_AUTH_MAX', 30),
    guestMutationPerMinute: positiveInt('RATE_LIMIT_GUEST_MUTATION_MAX', 60),
    menuSearchPerMinute: positiveInt('RATE_LIMIT_MENU_SEARCH_MAX', 120),
    aiPerMinute: positiveInt('RATE_LIMIT_AI_MAX', 20),
  },
  jwtAccessSecret: authSecret('JWT_ACCESS_SECRET', 'dev-access-secret'),
  jwtRefreshSecret: authSecret('JWT_REFRESH_SECRET', 'dev-refresh-secret'),
  accessTokenTtl: required('ACCESS_TOKEN_TTL', '15m'),
  refreshTokenTtl: required('REFRESH_TOKEN_TTL', '30d'),
  seedDemoPassword: required('SEED_DEMO_PASSWORD', 'MayCafe@2025'),
  guestAutoOpen: bool('GUEST_AUTO_OPEN', true),
  sessionIdleTimeoutMin: num('SESSION_IDLE_TIMEOUT_MIN', 60),
  ai: {
    mode: required('AI_MODE', 'fallback') as 'live' | 'fallback' | 'off',
    provider: required('AI_PROVIDER', 'openai'),
    model: required('AI_MODEL', 'gpt-4o-mini'),
    apiKey: process.env.AI_API_KEY ?? '',
    baseUrl: required('AI_BASE_URL', 'https://api.openai.com/v1'),
    timeoutMs: num('AI_TIMEOUT_MS', 15000),
  },
  anomaly: {
    enabled: bool('ANOMALY_ENABLED', true),
    intervalMs: positiveInt('ANOMALY_INTERVAL_MS', 60_000),
    windowMinutes: positiveInt('ANOMALY_WINDOW_MIN', 15),
    baselineMinutes: positiveInt('ANOMALY_BASELINE_MIN', 60),
    minSamples: positiveInt('ANOMALY_MIN_SAMPLES', 20),
    errorRateThreshold: fraction('ANOMALY_ERROR_RATE', 0.1),
    latencyP95Ms: positiveInt('ANOMALY_LATENCY_P95_MS', 1_000),
    preparationP95Seconds: positiveInt('ANOMALY_PREPARATION_P95_SECONDS', 900),
    cancellationRateThreshold: fraction('ANOMALY_CANCELLATION_RATE', 0.25),
    baselineMultiplier: positiveNumber('ANOMALY_BASELINE_MULTIPLIER', 2),
    cooldownMinutes: nonNegativeInt('ANOMALY_COOLDOWN_MIN', 30),
    aiMaxPerRun: nonNegativeInt('ANOMALY_AI_MAX_PER_RUN', 3),
  },
} as const;

export type AppConfig = typeof config;
