import { Link } from 'react-router-dom';
import type { GiftView } from '@may-cafe/contracts';
import { getErrorMessage } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import type { useGifts } from './useGifts';
import { minutesLeft, orderLabel, statusLabel } from './giftModel';

type Decision = 'ACCEPT' | 'DECLINE' | 'CANCEL';

interface Props {
  feed: ReturnType<typeof useGifts>;
  /** Phiên của bàn đang mở: chỉ khi đó mới nhận/từ chối/đặt/hủy được. */
  open: boolean;
  locked: boolean;
  page: number;
  onPageChange: (page: number) => void;
  onDecide: (gift: GiftView, decision: Decision) => void;
  onQuote: (gift: GiftView) => void;
}

export function GiftFeed({
  feed,
  open,
  locked,
  page,
  onPageChange,
  onDecide,
  onQuote,
}: Props): JSX.Element {
  const now = Date.now();
  const incoming = (gift: GiftView) =>
    gift.direction === 'RECEIVED' &&
    gift.status === 'PENDING' &&
    new Date(gift.expiresAt).getTime() > now;
  const items = [...(feed.data?.items ?? [])].sort(
    (a, b) => Number(incoming(b)) - Number(incoming(a)),
  );
  return (
    <section className="space-y-3" aria-label="Quà gửi và nhận">
      <h2 className="text-xl font-semibold">Quà của bàn</h2>
      {feed.isLoading && <p role="status">Đang tải quà…</p>}
      {feed.isError && <p role="alert">{getErrorMessage(feed.error)}</p>}
      {feed.data?.items.length === 0 && <p>Chưa có quà gửi hoặc nhận.</p>}
      {items.map((g) => (
        <GiftCard
          key={g.id}
          gift={g}
          open={open}
          locked={locked}
          onDecide={onDecide}
          onQuote={onQuote}
        />
      ))}
      {feed.data && feed.data.total > 30 && (
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            disabled={page === 1 || locked}
            onClick={() => onPageChange(page - 1)}
          >
            Trang trước
          </Button>
          <span>Trang {page}</span>
          <Button
            variant="outline"
            disabled={page * 30 >= feed.data.total || locked}
            onClick={() => onPageChange(page + 1)}
          >
            Trang sau
          </Button>
        </div>
      )}
    </section>
  );
}

function GiftCard({
  gift: g,
  open,
  locked,
  onDecide,
  onQuote,
}: {
  gift: GiftView;
  open: boolean;
  locked: boolean;
  onDecide: Props['onDecide'];
  onQuote: Props['onQuote'];
}): JSX.Element {
  const live = new Date(g.expiresAt).getTime() > Date.now();
  const active = live && ['PENDING', 'ACCEPTED'].includes(g.status);
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap justify-between gap-2">
        <h3 className="font-semibold">
          {g.direction === 'SENT'
            ? `Tặng ${g.recipientTableName}`
            : g.showSenderTable && g.senderTable
              ? `Quà từ ${g.senderTable.name}`
              : 'Một món quà ẩn danh dành cho bàn bạn'}
        </h3>
        <span className="text-sm">
          {!live && ['PENDING', 'ACCEPTED'].includes(g.status)
            ? 'Đã hết hạn'
            : statusLabel[g.status]}
        </span>
      </div>
      {g.direction === 'SENT' && (
        <p className="text-xs text-muted-foreground">
          {g.showSenderTable ? 'Hiện bàn gửi' : 'Ẩn danh'}
        </p>
      )}
      <ul className="space-y-1">
        {g.items.map((i, n) => (
          <li key={n}>
            {i.quantity} × {i.name} {i.variantName}
            {i.hasCupPhoto ? ' · Có ảnh tùy chỉnh' : ''}
            <span className="block text-xs text-muted-foreground">
              {[
                i.sugarLevel && `Đường ${i.sugarLevel}`,
                i.iceLevel && iceLabel(i.iceLevel),
                ...i.toppingNames,
                i.note,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </li>
        ))}
      </ul>
      {g.message && <p className="rounded-xl bg-background/50 p-3">“{g.message}”</p>}
      {active && (
        <p className="text-xs text-muted-foreground">Còn {minutesLeft(g.expiresAt)} phút</p>
      )}
      {g.orderStatus && (
        <p className="font-semibold">{orderLabel[g.orderStatus] ?? g.orderStatus}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {open && active && g.direction === 'RECEIVED' && g.status === 'PENDING' && (
          <>
            <Button disabled={locked} onClick={() => onDecide(g, 'ACCEPT')}>
              Nhận quà
            </Button>
            <Button variant="outline" disabled={locked} onClick={() => onDecide(g, 'DECLINE')}>
              Từ chối
            </Button>
          </>
        )}
        {open && active && g.direction === 'SENT' && g.status === 'ACCEPTED' && (
          <Button disabled={locked} onClick={() => onQuote(g)}>
            Xem giá & đặt quà
          </Button>
        )}
        {open && active && g.direction === 'SENT' && (
          <Button variant="outline" disabled={locked} onClick={() => onDecide(g, 'CANCEL')}>
            Hủy lời mời
          </Button>
        )}
        {g.direction === 'SENT' && g.orderId && (
          <Link className="p-2 underline" to="/orders">
            Xem đơn / yêu cầu hủy
          </Link>
        )}
      </div>
    </Card>
  );
}

function iceLabel(v: string): string {
  if (v === 'Theo công thức') return v;
  return v === 'no-ice' ? 'không đá' : v === 'less-ice' ? 'ít đá' : 'đá thường';
}
