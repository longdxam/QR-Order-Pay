import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { config } from '../../config/index.js';
import { refreshCookieName } from '../../controllers/cookieHelpers.js';

const mutableConfig = config as unknown as { staffAppUrl: string; adminAppUrl: string };
let originalStaffUrl: string;
let originalAdminUrl: string;

beforeEach(() => {
  originalStaffUrl = mutableConfig.staffAppUrl;
  originalAdminUrl = mutableConfig.adminAppUrl;
  mutableConfig.staffAppUrl = 'http://localhost:8081';
  mutableConfig.adminAppUrl = 'http://localhost:8082';
});

afterEach(() => {
  mutableConfig.staffAppUrl = originalStaffUrl;
  mutableConfig.adminAppUrl = originalAdminUrl;
});

describe('portal refresh cookies', () => {
  it('isolates staff and admin refresh sessions on the same host', () => {
    expect(refreshCookieName(requestFrom('http://localhost:8081'))).toBe('mc_refresh_staff');
    expect(refreshCookieName(requestFrom('http://localhost:8082'))).toBe('mc_refresh_admin');
    expect(refreshCookieName(requestFrom('http://localhost:8080'))).toBe('mc_refresh');
  });

  it('uses the referer origin when Origin is unavailable', () => {
    const req = { headers: { referer: 'http://localhost:8082/admin/dashboard' } } as Request;
    expect(refreshCookieName(req)).toBe('mc_refresh_admin');
  });
});

function requestFrom(origin: string): Request {
  return { headers: { origin } } as Request;
}
