import type { DashboardOverview } from '@may-cafe/contracts';

export function overviewToCsv(
  data: DashboardOverview,
  from: string | null,
  to: string | null,
): string {
  const rows: Array<Array<string | number>> = [
    ['Báo cáo Fantastic Cafe', `${displayDate(from)} - ${displayDate(to)}`],
    ['Thực thu ròng', data.totalRevenue],
    ['Tiền đã thu', data.grossCollected ?? 0],
    ['Tiền đã hoàn', data.totalRefunded ?? 0],
    ['Điều chỉnh', data.adjustmentAmount ?? 0],
    ['Số đơn có thu tiền', data.orderCount],
    ['Tiền thu trung bình/đơn', data.averageOrderValue],
    ['Đơn tạo trong kỳ', data.ordersCreated ?? 0],
    ['Đơn hủy trong nhóm đơn tạo trong kỳ', data.cancelledOrders ?? 0],
    ['Tỉ lệ hủy', data.cancellationRate == null ? 'Chưa có đơn' : data.cancellationRate],
    [],
    ['Doanh thu theo ngày'],
    ['Ngày', 'Doanh thu', 'Số đơn'],
    ...data.revenueByDay.map((item) => [item.date, item.revenue, item.orders]),
    [],
    ['Top sản phẩm'],
    ['Sản phẩm', 'Số lượng', 'Doanh thu'],
    ...data.topProducts.map((item) => [item.name, item.quantity, item.revenue]),
    [],
    ['Phương thức', 'Thu', 'Hoàn', 'Điều chỉnh', 'Ròng'],
    ...(data.revenueByMethod ?? []).map((item) => [
      (
        { CASH: 'Tiền mặt', BANK_TRANSFER: 'Chuyển khoản', OTHER: 'Khác' } as Record<string, string>
      )[item.method] ?? item.method,
      item.collected,
      item.refunded,
      item.adjustment,
      item.revenue,
    ]),
    [],
    ['Danh mục hiện tại; tiền món trước ưu đãi/hoàn/điều chỉnh', 'Số món', 'Tiền món'],
    ...(data.categorySales ?? []).map((item) => [item.name, item.quantity, item.revenue]),
    [],
    ['Giờ tạo đơn (Việt Nam)', 'Số đơn (gồm đã hủy/chờ thanh toán)'],
    ...(data.ordersByHour ?? []).map((item) => [item.hour, item.orders]),
    ...(data.comparison
      ? [
          [],
          ['Kỳ trước cùng số ngày', `${data.comparison.from} - ${data.comparison.to}`],
          ['Thực thu ròng kỳ trước', data.comparison.totalRevenue],
          ['Đơn tạo kỳ trước', data.comparison.ordersCreated],
          ['Đơn hủy kỳ trước', data.comparison.cancelledOrders],
        ]
      : []),
  ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
}

function displayDate(value: string | null): string {
  return value?.slice(0, 10) ?? '';
}

function csvCell(value: string | number): string {
  const raw = String(value);
  const safe = typeof value === 'string' && /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}
