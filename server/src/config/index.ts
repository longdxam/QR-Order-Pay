import dotenv from 'dotenv';
import path from 'node:path';
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

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return v === 'true' || v === '1';
}

export const config = {
  env: required('NODE_ENV', 'development'),
  port: num('PORT', 4000),
  publicAppUrl: required('PUBLIC_APP_URL', 'http://localhost:5173'),
  serverOrigin: required('SERVER_ORIGIN', 'http://localhost:4000'),
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,
  cookieSecure: bool('COOKIE_SECURE', false),
  logLevel: required('LOG_LEVEL', 'info'),
  mongoUri: required('MONGODB_URI', 'mongodb://127.0.0.1:27017/maycafe?replicaSet=rs0&directConnection=true'),
  jwtAccessSecret: required('JWT_ACCESS_SECRET', 'dev-access-secret'),
  jwtRefreshSecret: required('JWT_REFRESH_SECRET', 'dev-refresh-secret'),
  accessTokenTtl: required('ACCESS_TOKEN_TTL', '15m'),
  refreshTokenTtl: required('REFRESH_TOKEN_TTL', '30d'),
  seedDemoPassword: required('SEED_DEMO_PASSWORD', 'MayCafe@2025'),
  ai: {
    mode: required('AI_MODE', 'fallback') as 'live' | 'fallback' | 'off',
    provider: required('AI_PROVIDER', 'openai'),
    model: required('AI_MODEL', 'gpt-4o-mini'),
    apiKey: process.env.AI_API_KEY ?? '',
    baseUrl: required('AI_BASE_URL', 'https://api.openai.com/v1'),
    timeoutMs: num('AI_TIMEOUT_MS', 15000),
  },
} as const;

export type AppConfig = typeof config;
