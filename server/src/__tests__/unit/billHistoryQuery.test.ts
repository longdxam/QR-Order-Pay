import { describe, expect, it } from 'vitest';
import { billHistoryQuerySchema } from '@may-cafe/contracts';

describe('bill history query contract', () => {
  it('treats empty filters from the admin form as no filter', () => {
    // Trang Admin → Hóa đơn gửi mọi ô lọc kể cả khi để trống.
    const parsed = billHistoryQuerySchema.parse({
      q: '',
      table: '  ',
      cashier: '',
      from: '',
      to: '',
      page: '1',
      limit: '20',
    });
    expect(parsed).toEqual({ page: 1, limit: 20 });
  });

  it('keeps real filters and still rejects malformed dates', () => {
    expect(
      billHistoryQuerySchema.parse({ q: ' HD001 ', table: 'B01', from: '2026-09-01' }),
    ).toMatchObject({ q: 'HD001', table: 'B01', from: '2026-09-01', page: 1, limit: 20 });
    expect(() => billHistoryQuerySchema.parse({ from: '01/09/2026' })).toThrow();
  });
});
