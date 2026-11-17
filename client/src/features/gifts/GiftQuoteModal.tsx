import type { GiftView, OrderQuoteResponse } from '@may-cafe/contracts';
import { vnd } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';

export type GiftQuote = { gift: GiftView; quote: OrderQuoteResponse };

interface Props {
  quote: GiftQuote | null;
  locked: boolean;
  onClose: () => void;
  onConfirm: (quote: GiftQuote) => void;
}

/** Người gửi xem giá do server tính lại rồi mới tạo đơn quà; khóa khi lời mời đã hết hạn. */
export function GiftQuoteModal({ quote, locked, onClose, onConfirm }: Props): JSX.Element {
  return (
    <Modal
      open={!!quote}
      onOpenChange={(value) => {
        if (!value && !locked) onClose();
      }}
      title="Xác nhận đặt quà"
    >
      {quote && (
        <div className="space-y-4">
          <p>
            Giao tới <strong>{quote.gift.recipientTableName}</strong>. Bạn trả tiền cho đơn này.
          </p>
          {quote.quote.items.map((i, n) => (
            <p key={n}>
              {i.quantity} × {i.name} {i.variantName} · {vnd(i.lineTotal)}
            </p>
          ))}
          <p className="text-xl font-semibold">Tổng {vnd(quote.quote.total)}</p>
          <p className="text-sm">Nhân viên chỉ pha sau khi xác nhận nhận đủ tiền.</p>
          <Button
            disabled={locked || new Date(quote.gift.expiresAt).getTime() <= Date.now()}
            onClick={() => onConfirm(quote)}
          >
            Xác nhận đặt · {vnd(quote.quote.total)}
          </Button>
        </div>
      )}
    </Modal>
  );
}
