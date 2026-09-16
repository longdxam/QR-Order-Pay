import { orderRepository } from '../repositories/orderRepository.js';
import { ProductModel } from '../models/Product.js';

function startOfDayLocal(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDayLocal(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

export async function overview(from?: Date, to?: Date) {
  const today = new Date();
  const defaultFrom = new Date(today.getTime() - 29 * 86400000);
  const f = from ? startOfDayLocal(from) : startOfDayLocal(defaultFrom);
  const t = to ? endOfDayLocal(to) : endOfDayLocal(today);

  const revenueAgg = await orderRepository.sumPaidTotal(f, t);
  const orderCount = await orderRepository.list({
    from: f,
    to: new Date(t.getTime() + 1),
    paymentStatus: 'PAID',
    limit: 1,
  });
  const paidOrders = (
    await orderRepository.list({ from: f, to: new Date(t.getTime() + 1), paymentStatus: 'PAID', limit: 500 })
  ).items;

  const revenue = paidOrders.reduce((s, o) => s + o.total, 0);
  const count = paidOrders.length;

  const topProductsMap = new Map<string, { productId: string; quantity: number; revenue: number }>();
  for (const order of paidOrders) {
    for (const item of order.items) {
      const key = item.productId.toString();
      const cur = topProductsMap.get(key) ?? { productId: key, quantity: 0, revenue: 0 };
      cur.quantity += item.quantity;
      cur.revenue += item.lineTotal;
      topProductsMap.set(key, cur);
    }
  }
  const topProductsArr = [...topProductsMap.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 5);
  const productDocs = await ProductModel.find({ _id: { $in: topProductsArr.map((p) => p.productId) } });
  const productNameMap = new Map(productDocs.map((p) => [p._id.toString(), p.name]));
  const topProducts = topProductsArr.map((p) => ({
    productId: p.productId,
    name: productNameMap.get(p.productId) ?? 'Món',
    quantity: p.quantity,
    revenue: p.revenue,
  }));

  // revenue by day
  const days: { date: string; revenue: number; orders: number }[] = [];
  const dayMap = new Map<string, { revenue: number; orders: number }>();
  for (const order of paidOrders) {
    const d = new Date(order.createdAt);
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const cur = dayMap.get(key) ?? { revenue: 0, orders: 0 };
    cur.revenue += order.total;
    cur.orders += 1;
    dayMap.set(key, cur);
  }
  for (const [date, val] of [...dayMap.entries()].sort()) {
    days.push({ date, ...val });
  }

  // revenue by hour (0-23)
  const hours = Array.from({ length: 24 }, () => 0);
  for (const order of paidOrders) {
    const h = new Date(order.createdAt).getHours();
    hours[h] = (hours[h] ?? 0) + order.total;
  }
  const revenueByHour = hours.map((revenue, hour) => ({ hour, revenue }));

  return {
    totalRevenue: revenueAgg,
    orderCount: orderCount.total,
    averageOrderValue: count > 0 ? Math.round(revenue / count) : 0,
    topProducts,
    revenueByDay: days,
    revenueByHour,
  };
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}
