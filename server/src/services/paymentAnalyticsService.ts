import { paymentRepository } from '../repositories/paymentRepository.js';

export async function paymentAnalytics(from: Date, to: Date) {
  const result = await paymentRepository.ledgerEventFacets(from, to);
  const summary = result?.summary[0] ?? {
    grossCollected: 0,
    totalRefunded: 0,
    adjustmentAmount: 0,
    totalRevenue: 0,
    eventCount: 0,
  };
  const orderCount = result?.count[0]?.value ?? 0;
  return {
    ...summary,
    hasFinancialData: summary.eventCount > 0,
    revenueByMethod: result?.revenueByMethod ?? [],
    orderCount,
    averageOrderValue: orderCount ? Math.round(summary.grossCollected / orderCount) : 0,
    revenueByDay: result?.revenueByDay ?? [],
    revenueByHour: result?.revenueByHour ?? [],
  };
}
