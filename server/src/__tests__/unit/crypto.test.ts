import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, sha256, signAccessToken, verifyAccessToken, randomToken, randomShortCode, parseTtlToMs } from '../../utils/crypto.js';

describe('crypto utils', () => {
  it('hashes and verifies password', async () => {
    const hash = await hashPassword('secret-123');
    expect(await verifyPassword('secret-123', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('signs and verifies access token', () => {
    const token = signAccessToken({ sub: 'abc', role: 'ADMIN', name: 'Admin' });
    const payload = verifyAccessToken(token);
    expect(payload.sub).toBe('abc');
    expect(payload.role).toBe('ADMIN');
  });

  it('sha256 is deterministic and length 64', () => {
    const h = sha256('hello');
    expect(h).toMatch(/^[a-f0-9]{64}$/);
    expect(sha256('hello')).toBe(h);
  });

  it('randomToken returns base64url strings', () => {
    const t = randomToken(20);
    expect(typeof t).toBe('string');
    expect(t.length).toBeGreaterThan(20);
  });

  it('randomShortCode returns uppercase alnum without I/O/0/1', () => {
    const code = randomShortCode(6);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });

  it('parses TTL strings', () => {
    expect(parseTtlToMs('30s')).toBe(30_000);
    expect(parseTtlToMs('15m')).toBe(900_000);
    expect(parseTtlToMs('2h')).toBe(7_200_000);
    expect(parseTtlToMs('7d')).toBe(7 * 86_400_000);
  });
});
