import { describe, expect, it, vi } from 'vitest';
import {
  createAdmissionTicket,
  verifyAdmissionTicket,
  createStaticAdmissionTicket,
  verifyTableTicket,
} from '../../services/tableQrService.js';

describe('fixed table QR with legacy ticket compatibility', () => {
  const tableId = '0123456789abcdef01234567';
  const now = 1_800_000_000_000;
  it('issues stable static QR without a clock deadline and rejects tampering', () => {
    const ticket = createStaticAdmissionTicket(tableId, 2);
    expect(createStaticAdmissionTicket(tableId, 2)).toEqual(ticket);
    expect(verifyTableTicket(ticket.token)).toEqual({ tableId, epoch: 2, fixed: true });
    expect(createStaticAdmissionTicket(tableId, 3)).not.toEqual(ticket);
    expect(() => verifyTableTicket(`${ticket.token}x`)).toThrow();
    expect(() => verifyTableTicket(`${ticket.token}.extra`)).toThrow();
    expect(() => verifyAdmissionTicket(ticket.token, now)).toThrow();
  });
  it('keeps a fixed ticket unchanged across minute boundaries and days', () => {
    const clock = vi.spyOn(Date, 'now');
    try {
      clock.mockReturnValue(now);
      const ticket = createStaticAdmissionTicket(tableId, 0);
      for (const elapsed of [61000, 3600000, 7 * 86400000]) {
        clock.mockReturnValue(now + elapsed);
        expect(createStaticAdmissionTicket(tableId, 0)).toEqual(ticket);
        expect(verifyTableTicket(ticket.token)).toEqual({ tableId, epoch: 0, fixed: true });
      }
    } finally {
      clock.mockRestore();
    }
  });
  it('legacy qr1 only: expires at the next 60-second boundary', () => {
    const ticket = createAdmissionTicket(tableId, 2, now);
    expect(ticket.expiresAt).toBe(now + 60_000);
    expect(createAdmissionTicket(tableId, 2, now + 30_000)).toEqual(ticket);
    expect(verifyAdmissionTicket(ticket.token, now + 59_999)).toEqual({ tableId, epoch: 2 });
    expect(() => verifyAdmissionTicket(ticket.token, ticket.expiresAt)).toThrow();
    expect(createAdmissionTicket(tableId, 2, now + 60_000).token).not.toBe(ticket.token);
  });
  it('rejects changed data, signature, static tokens, oversize and future tickets', () => {
    const ticket = createAdmissionTicket(tableId, 0, now);
    const [prefix, body, signature] = ticket.token.split('.');
    const changed = Buffer.from(
      JSON.stringify({ tableId: 'f'.repeat(24), epoch: 0, expiresAt: ticket.expiresAt }),
    ).toString('base64url');
    for (const value of [
      `${prefix}.${changed}.${signature}`,
      `${prefix}.${body}.invalid`,
      'old-static-token',
      'x'.repeat(1025),
      `${ticket.token}.extra`,
    ])
      expect(() => verifyAdmissionTicket(value, now)).toThrow();
    expect(() =>
      verifyAdmissionTicket(createAdmissionTicket(tableId, 0, now + 120_000).token, now),
    ).toThrow();
  });
});
