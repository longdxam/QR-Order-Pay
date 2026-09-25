import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { config } from '../../config/index.js';
import { validateQuote, type PricedCart } from '../../services/orderPricingService.js';
import type { PlaceOrderItemInput } from '../../services/orderService.js';

const items: PlaceOrderItemInput[] = [
  {
    productId: 'product-1',
    variantId: 'variant-1',
    sugarLevel: '50%',
    iceLevel: 'normal-ice',
    toppingIds: [],
    quantity: 1,
  },
];
const priced: PricedCart = { items: [], total: 35_000, catalogFingerprint: 'catalog-v1' };

describe('signed order quote validation', () => {
  it('rejects an expired quote', () => {
    expectQuoteChanged(
      token({ expiresAt: Date.now() - 1 }),
      { tableSessionId: 'session-1', participantId: 'guest-1', items },
      priced,
      'QUOTE_EXPIRED',
    );
  });

  it('rejects a quote belonging to another participant', () => {
    expectQuoteChanged(
      token(),
      { tableSessionId: 'session-1', participantId: 'guest-2', items },
      priced,
      'QUOTE_OWNERSHIP',
    );
  });

  it('rejects quantity changes after confirmation', () => {
    expectQuoteChanged(
      token(),
      {
        tableSessionId: 'session-1',
        participantId: 'guest-1',
        items: [{ ...items[0]!, quantity: 2 }],
      },
      { ...priced, total: 70_000 },
      'CART_CHANGED',
    );
  });

  it('rejects a changed catalog fingerprint or total', () => {
    expectQuoteChanged(
      token(),
      { tableSessionId: 'session-1', participantId: 'guest-1', items },
      { ...priced, catalogFingerprint: 'catalog-v2', total: 40_000 },
      'CATALOG_CHANGED',
    );
  });
});

function token(overrides: Record<string, unknown> = {}): string {
  const payload = {
    quoteId: 'quote-1',
    tableSessionId: 'session-1',
    participantId: 'guest-1',
    requestFingerprint: digest(
      items.map((item) => ({ ...item, toppingIds: [...item.toppingIds].sort(), note: '' })),
    ),
    catalogFingerprint: priced.catalogFingerprint,
    total: priced.total,
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', `quote:${config.jwtAccessSecret}`)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${signature}`;
}

function expectQuoteChanged(
  quoteToken: string,
  input: { tableSessionId: string; participantId: string; items: PlaceOrderItemInput[] },
  current: PricedCart,
  reason: string,
): void {
  try {
    validateQuote({ quoteToken, ...input }, current);
    throw new Error('Expected quote validation to fail');
  } catch (error) {
    expect(error).toMatchObject({ code: 'QUOTE_CHANGED', details: { reason } });
  }
}

function digest(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
