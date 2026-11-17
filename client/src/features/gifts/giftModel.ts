import type { GiftView } from '@may-cafe/contracts';
import type { CartItem } from '../../store/cart';

/** Một yêu cầu ghi đang chờ kết quả; giữ trong sessionStorage để thử lại đúng request sau khi tải lại. */
export type Pending = { url: string; payload: unknown; key: string };

export const statusLabel: Record<GiftView['status'], string> = {
  PENDING: 'Chờ bàn nhận',
  ACCEPTED: 'Đã nhận · chờ người gửi đặt',
  DECLINED: 'Đã từ chối',
  CANCELLED: 'Đã hủy',
  EXPIRED: 'Đã hết hạn',
  ORDERED: 'Đã tạo đơn',
};

export const orderLabel: Record<string, string> = {
  AWAITING_PAYMENT: 'Chờ người gửi trả tiền',
  PENDING: 'Đã trả tiền',
  CONFIRMED: 'Đã nhận đơn',
  PREPARING: 'Đang pha',
  READY: 'Sẵn sàng giao',
  SERVED: 'Đã giao quà',
  CANCELLED: 'Đơn đã hủy',
};

export const MAX_LINES_ERROR = 'Tối đa 10 dòng món, mỗi dòng 10 phần.';

export const toItems = (items: Array<GiftView['items'][number] | Omit<CartItem, 'clientId'>>) =>
  items.map((i) => ({
    productId: i.productId,
    variantId: i.variantId,
    sugarLevel: i.sugarLevel,
    iceLevel: i.iceLevel,
    toppingIds: i.toppingIds,
    note: i.note,
    quantity: i.quantity,
    ...(i.cupPhotoId ? { cupPhotoId: i.cupPhotoId } : {}),
  }));

/** Chỉ khôi phục request tới đúng các endpoint quà/đơn mà trang này gửi. */
export function readPending(storageKey: string): Pending | null {
  try {
    const raw = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as Pending | null;
    return raw &&
      typeof raw.url === 'string' &&
      /^\/(gifts(?:\/[a-f\d]{24}\/decision)?|orders)$/.test(raw.url) &&
      typeof raw.key === 'string'
      ? raw
      : null;
  } catch {
    return null;
  }
}

/** Lời mời đang chờ thử lại có chọn "Hiện bàn gửi" hay không, để form hiển thị đúng lựa chọn cũ. */
export function pendingShowsSender(pending: Pending | null): boolean {
  return (
    pending?.url === '/gifts' &&
    typeof pending.payload === 'object' &&
    pending.payload !== null &&
    'showSenderTable' in pending.payload &&
    pending.payload.showSenderTable === true
  );
}

/** Số phút còn lại của lời mời, tối thiểu 1. */
export const minutesLeft = (expiresAt: string, now = Date.now()): number =>
  Math.max(1, Math.ceil((new Date(expiresAt).getTime() - now) / 60000));
