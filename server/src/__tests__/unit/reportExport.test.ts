import { describe, expect, it } from 'vitest';
import type { DashboardOverview } from '@may-cafe/contracts';
import { overviewToCsv } from '../../services/reportExportService.js';

describe('overviewToCsv', () => {
  it('keeps negative money numeric while escaping formula-like names', () => {
    const csv = overviewToCsv(
      {
        totalRevenue: -90000,
        grossCollected: 0,
        totalRefunded: 90000,
        adjustmentAmount: 0,
        orderCount: 0,
        averageOrderValue: 0,
        topProducts: [{ productId: 'p', name: '-formula', quantity: 1, revenue: 90000 }],
        revenueByDay: [{ date: '2026-10-27', revenue: -90000, orders: 0 }],
        revenueByHour: [],
      },
      null,
      null,
    );
    expect(csv).toContain('"-90000"');
    expect(csv).not.toContain('"\'-90000"');
    expect(csv).toContain('"\'-formula"');
  });
  it('creates a UTF-8 CSV and neutralizes spreadsheet formulas', () => {
    const overview: DashboardOverview = {
      grossCollected: 100000,
      totalRefunded: 0,
      adjustmentAmount: 0,
      totalRevenue: 100_000,
      orderCount: 2,
      averageOrderValue: 50_000,
      revenueByDay: [{ date: '2026-09-23', revenue: 100_000, orders: 2 }],
      revenueByHour: Array.from({ length: 24 }, (_, hour) => ({ hour, revenue: 0 })),
      topProducts: [{ productId: '1', name: '=IMPORTXML("bad")', quantity: 2, revenue: 100_000 }],
    };

    const csv = overviewToCsv(overview, '2026-09-01', '2026-09-23');

    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain("'=IMPORTXML");
    expect(csv).toContain('2026-09-01 - 2026-09-23');
  });
});
