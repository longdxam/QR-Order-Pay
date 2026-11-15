import { orderRepository } from '../repositories/orderRepository.js';
import { paymentAnalytics } from './paymentAnalyticsService.js';
import { operationalAnalytics } from '../repositories/dashboardRepository.js';

const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;

function startOfDayVietnam(date: Date): Date {
  const vietnam = new Date(date.getTime() + VIETNAM_OFFSET_MS);
  return new Date(
    Date.UTC(vietnam.getUTCFullYear(), vietnam.getUTCMonth(), vietnam.getUTCDate()) -
      VIETNAM_OFFSET_MS,
  );
}

function endOfDayVietnam(date: Date): Date {
  return new Date(startOfDayVietnam(date).getTime() + 86_400_000 - 1);
}

export async function overview(from?: Date, to?: Date) {
  const today = new Date();
  const defaultFrom = new Date(today.getTime() - 29 * 86400000);
  const f = from ? startOfDayVietnam(from) : startOfDayVietnam(defaultFrom);
  const t = to ? endOfDayVietnam(to) : endOfDayVietnam(today);

  const until = new Date(t.getTime() + 1);
  const previousFrom = new Date(f.getTime() - (until.getTime() - f.getTime()));
  const [sales, financial, operations, previousFinancial, previousOperations] = await Promise.all([
    orderRepository.paidAnalytics(f, until),
    paymentAnalytics(f, until),
    operationalAnalytics(f, until),
    paymentAnalytics(previousFrom, f),
    operationalAnalytics(previousFrom, f),
  ]);
  const analytics = { ...sales, ...financial };
  const revenueByHour = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    revenue: analytics.revenueByHour.find((item) => item.hour === hour)?.revenue ?? 0,
  }));
  const dayKey = (date: Date) =>
    new Date(date.getTime() + VIETNAM_OFFSET_MS).toISOString().slice(0, 10);
  const days = new Map(financial.revenueByDay.map((row) => [row.date, row]));
  const revenueByDay = Array.from(
    { length: Math.round((until.getTime() - f.getTime()) / 86400000) },
    (_, index) => {
      const date = dayKey(new Date(f.getTime() + index * 86400000));
      return days.get(date) ?? { date, revenue: 0, orders: 0 };
    },
  );
  return {
    ...analytics,
    ...operations,
    revenueByHour,
    revenueByDay,
    comparison: {
      from: dayKey(previousFrom),
      to: dayKey(new Date(f.getTime() - 1)),
      totalRevenue: previousFinancial.totalRevenue,
      orderCount: previousFinancial.orderCount,
      ordersCreated: previousOperations.ordersCreated,
      cancelledOrders: previousOperations.cancelledOrders,
      cancellationRate: previousOperations.cancellationRate,
    },
  };
}
