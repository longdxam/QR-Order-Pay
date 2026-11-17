export function recordTime(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function orderLabel(order: {
  tableName?: string | null;
  createdAt?: string | null;
}): string {
  return [order.tableName || 'Đơn hàng', recordTime(order.createdAt)].filter(Boolean).join(' · ');
}
