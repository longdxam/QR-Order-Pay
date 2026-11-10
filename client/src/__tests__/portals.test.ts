// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { getPortalMode, portalHome } from '../lib/portals';

afterEach(() =>
  document.head
    .querySelectorAll('meta[name="fantastic-cafe-portal"]')
    .forEach((meta) => meta.remove()),
);

describe('portal identity from the serving proxy', () => {
  it('opens QR entry and preserves separate internal portal homes', () => {
    expect(portalHome('guest')).toBe('/t');
    expect(portalHome('unified')).toBe('/t');
    expect(portalHome('staff')).toBe('/staff');
    expect(portalHome('admin')).toBe('/admin');
  });
  it('uses the guest portal on a public hostname even when build URLs refer to localhost', () => {
    const meta = document.createElement('meta');
    meta.name = 'fantastic-cafe-portal';
    meta.content = 'guest';
    document.head.append(meta);
    expect(getPortalMode()).toBe('guest');
    meta.content = 'staff';
    expect(getPortalMode()).toBe('staff');
    meta.content = 'admin';
    expect(getPortalMode()).toBe('admin');
  });

  it('does not override an explicitly inspected origin or trust an unknown portal', () => {
    const meta = document.createElement('meta');
    meta.name = 'fantastic-cafe-portal';
    meta.content = 'guest';
    document.head.append(meta);
    expect(getPortalMode('http://localhost:8082')).toBe('admin');
    meta.content = 'unknown';
    expect(getPortalMode('https://unknown.example')).toBe('unified');
  });
});
