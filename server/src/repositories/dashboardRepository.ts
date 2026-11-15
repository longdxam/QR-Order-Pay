import { OrderModel } from '../models/Order.js';

// Demand is measured when orders are created, independently of when money changes hands.
export async function operationalAnalytics(from: Date, to: Date) {
  const [result] = await OrderModel.aggregate<{
    summary: Array<{ ordersCreated: number; cancelledOrders: number }>;
    ordersByHour: Array<{ hour: number; orders: number }>;
    categorySales: Array<{ categoryId: string; name: string; quantity: number; revenue: number }>;
  }>([
    { $match: { createdAt: { $gte: from, $lt: to } } },
    {
      $facet: {
        summary: [
          {
            $group: {
              _id: null,
              ordersCreated: { $sum: 1 },
              cancelledOrders: { $sum: { $cond: [{ $eq: ['$status', 'CANCELLED'] }, 1, 0] } },
            },
          },
        ],
        ordersByHour: [
          {
            $group: {
              _id: { $hour: { date: '$createdAt', timezone: 'Asia/Ho_Chi_Minh' } },
              orders: { $sum: 1 },
            },
          },
          { $project: { _id: 0, hour: '$_id', orders: 1 } },
          { $sort: { hour: 1 } },
        ],
        categorySales: [
          { $match: { paymentStatus: 'PAID', status: { $ne: 'CANCELLED' } } },
          { $unwind: '$items' },
          {
            $lookup: {
              from: 'products',
              localField: 'items.productId',
              foreignField: '_id',
              as: 'product',
            },
          },
          {
            $lookup: {
              from: 'categories',
              localField: 'product.categoryId',
              foreignField: '_id',
              as: 'category',
            },
          },
          {
            $group: {
              _id: { $ifNull: [{ $arrayElemAt: ['$category._id', 0] }, null] },
              name: {
                $first: { $ifNull: [{ $arrayElemAt: ['$category.name', 0] }, 'Chưa phân loại'] },
              },
              quantity: { $sum: '$items.quantity' },
              revenue: { $sum: '$items.lineTotal' },
            },
          },
          {
            $project: {
              _id: 0,
              categoryId: { $ifNull: [{ $toString: '$_id' }, 'unknown'] },
              name: 1,
              quantity: 1,
              revenue: 1,
            },
          },
          { $sort: { revenue: -1, name: 1 } },
        ],
      },
    },
  ]);
  const summary = result?.summary[0] ?? { ordersCreated: 0, cancelledOrders: 0 };
  return {
    ...summary,
    cancellationRate: summary.ordersCreated
      ? summary.cancelledOrders / summary.ordersCreated
      : null,
    ordersByHour: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      orders: result?.ordersByHour.find((row) => row.hour === hour)?.orders ?? 0,
    })),
    categorySales: result?.categorySales ?? [],
  };
}
