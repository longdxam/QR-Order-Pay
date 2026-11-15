import {
  reservationCreateSchema,
  type Reservation,
  type ReservationCreate,
} from '@may-cafe/contracts';

/** Hiển thị theo giờ Việt Nam, bất kể múi giờ thiết bị. */
export const vnTime = (s: string): string =>
  new Date(s).toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour12: false,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
/** Giá trị `datetime-local` theo giờ Việt Nam. */
export const localTime = (d: Date): string =>
  new Date(d.getTime() + 7 * 3600000).toISOString().slice(0, 16);

export const labels: Record<Reservation['status'], string> = {
  CONFIRMED: 'Đang giữ chỗ',
  CHECKED_IN: 'Đã đến',
  COMPLETED: 'Hoàn tất',
  CANCELLED: 'Đã hủy',
  NO_SHOW: 'Không đến',
};

// Yêu cầu đặt bàn chưa rõ kết quả (mạng/5xx) được giữ trong sessionStorage để thử lại cùng requestId
// sau khi tải lại trang, tránh đặt trùng.
export function readPending(key: string): ReservationCreate | null {
  try {
    const parsed = reservationCreateSchema.safeParse(
      JSON.parse(sessionStorage.getItem(key) ?? 'null'),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
export function savePending(key: string, value: ReservationCreate | null): void {
  try {
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
  } catch {
    /* In-memory replay remains available. */
  }
}
