import { describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import { requestId } from '../../middlewares/error.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type FakeRes = { setHeader: ReturnType<typeof vi.fn>; headerNames: string[] };

function run(headers: Record<string, unknown>): { reqId: string; res: FakeRes } {
  const req = { headers } as unknown as Request;
  const recorded: string[] = [];
  const res = {
    setHeader: vi.fn((_name: string, value: string) => {
      recorded.push(value);
    }),
    headerNames: recorded,
  };
  requestId(req, res as unknown as Parameters<typeof requestId>[1], vi.fn());
  return { reqId: (req as unknown as { requestId: string }).requestId, res: res as FakeRes };
}

describe('requestId middleware', () => {
  it('keeps a well-formed client requestId unchanged', () => {
    const { reqId, res } = run({ 'x-request-id': 'abc-123_DEF.4' });
    expect(reqId).toBe('abc-123_DEF.4');
    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', 'abc-123_DEF.4');
  });

  it('generates a UUID when the header is missing', () => {
    const { reqId } = run({});
    expect(reqId).toMatch(UUID_PATTERN);
  });

  it('replaces overlong request ids with a generated UUID', () => {
    const { reqId } = run({ 'x-request-id': 'a'.repeat(200) });
    expect(reqId).toMatch(UUID_PATTERN);
  });

  it('replaces request ids with unsafe characters (path/header injection)', () => {
    for (const evil of ['../etc/passwd', 'id\r\nX-Injected: 1', '<script>', 'sp ace', 'a'.repeat(65)]) {
      const { reqId } = run({ 'x-request-id': evil });
      expect(reqId).toMatch(UUID_PATTERN);
    }
  });

  it('does not reuse a generated id across requests', () => {
    const first = run({}).reqId;
    const second = run({}).reqId;
    expect(first).not.toBe(second);
  });
});
