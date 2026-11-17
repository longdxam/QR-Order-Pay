import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type {
  CurrentTableSessionResponse,
  GiftCreate,
  GiftTable,
  GiftView,
  OrderQuoteResponse,
} from '@may-cafe/contracts';
import { api, unwrap, getErrorMessage, generateRequestId } from '../../lib/api';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ProductDetailModal, type Product } from '../guest/ProductDetailModal';
import { usePublicMenu } from '../guest/usePublicMenu';
import { useGifts } from './useGifts';
import { useCupPhotoBusy } from '../cupPhotos/useCupPhotoBusy';
import { AISheet } from '../ai/AISheet';
import { MAX_LINES_ERROR, pendingShowsSender, toItems, type Pending } from './giftModel';
import { useGiftSubmit } from './useGiftSubmit';
import { useGiftDraft, type DraftItem } from './useGiftDraft';
import { GiftComposer } from './GiftComposer';
import { GiftFeed } from './GiftFeed';
import { GiftQuoteModal, type GiftQuote } from './GiftQuoteModal';

export function GiftsPage(): JSX.Element {
  useDocumentTitle('Tặng quà');
  const session = useQuery({
    queryKey: ['guest-session'],
    queryFn: async () =>
      unwrap<CurrentTableSessionResponse>(await api.get('/table-sessions/current')),
  });
  if (session.isLoading) return <p role="status">Đang kiểm tra bàn…</p>;
  if (session.isError) return <p role="alert">{getErrorMessage(session.error)}</p>;
  if (!session.data?.active)
    return (
      <Card className="p-6">
        <h1 className="text-2xl font-semibold">Tặng quà cho bàn khác</h1>
        <p className="my-4">Quét QR tại bàn để gửi và nhận quà.</p>
        <Link to="/t">Vào bàn</Link>
      </Card>
    );
  const owner = `${session.data.tableSessionId}:${session.data.participantId}`;
  return <GiftWorkspace key={owner} owner={owner} open={session.data.status === 'OPEN'} />;
}

function GiftWorkspace({ owner, open }: { owner: string; open: boolean }): JSX.Element {
  const [page, setPage] = useState(1);
  const feed = useGifts(owner, page);
  const tables = useQuery({
    queryKey: ['gift-tables', owner],
    enabled: open,
    queryFn: async () => unwrap<{ items: GiftTable[] }>(await api.get('/gifts/tables')),
    refetchInterval: 10000,
  });
  const menu = usePublicMenu({ enabled: open });
  const { photoBusy, setPhotoBusy } = useCupPhotoBusy();
  const [aiOpen, setAiOpen] = useState(false);
  const [product, setProduct] = useState<Product | null>(null);
  const [checking, setChecking] = useState(false);
  const [quote, setQuote] = useState<GiftQuote | null>(null);
  const { pending, error, setError, busy, submit } = useGiftSubmit(owner, () => {
    draft.clearAfterSend();
    setPage(1);
  });
  const draft = useGiftDraft(pendingShowsSender(pending));
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const locked = busy || !!pending || checking || photoBusy;
  const targetValid = tables.data?.items.some(
    (t) =>
      t.available &&
      t.tableId === draft.selected?.tableId &&
      t.sessionId === draft.selected.sessionId,
  );
  const send = (action: Pending) => submit(action, () => setQuote(null));
  async function checkQuote(gift: GiftView) {
    setChecking(true);
    setError('');
    try {
      const value = unwrap<OrderQuoteResponse>(
        await api.post('/orders/quote', { items: toItems(gift.items) }),
      );
      setQuote({ gift, quote: value });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setChecking(false);
    }
  }
  const search = draft.search.toLocaleLowerCase('vi');
  const availableProducts = (menu.data?.products ?? []).filter(
    (p) => p.isAvailable && !p.isArchived && p.name.toLocaleLowerCase('vi').includes(search),
  );
  function addItem(item: DraftItem): boolean {
    if (locked || draft.items.length >= 10 || item.quantity > 10) {
      setError(MAX_LINES_ERROR);
      return false;
    }
    draft.setItems((values) => [...values, item]);
    return true;
  }
  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-8">
      <div>
        <h1 className="font-display text-3xl font-semibold">Một món quà, một niềm vui</h1>
      </div>
      {error && (
        <p role="alert" className="rounded-xl border border-danger p-3">
          {error}
        </p>
      )}
      {pending && (
        <Card className="p-4" role="status">
          <p>Chưa rõ kết quả. Thử lại cùng yêu cầu để tránh gửi trùng.</p>
          <Button className="mt-2" disabled={busy} onClick={() => void send(pending)}>
            Thử lại yêu cầu
          </Button>
        </Card>
      )}
      <GiftFeed
        feed={feed}
        open={open}
        locked={locked}
        page={page}
        onPageChange={setPage}
        onDecide={(gift, decision) =>
          void send({
            url: `/gifts/${gift.id}/decision`,
            payload: { expectedVersion: gift.version, decision },
            key: generateRequestId(),
          })
        }
        onQuote={(gift) => void checkQuote(gift)}
      />
      {open && (
        <GiftComposer
          draft={draft}
          tables={tables}
          menuError={menu.isError ? menu.error : null}
          menuLoading={menu.isLoading}
          availableProducts={availableProducts}
          targetValid={targetValid}
          formDisabled={busy || !!pending || checking}
          locked={locked}
          onPickProduct={setProduct}
          onOpenAi={() => setAiOpen(true)}
          onPhotoBusy={setPhotoBusy}
          onSend={() => {
            const payload: GiftCreate = {
              requestId: generateRequestId(),
              recipientTableId: draft.selected!.tableId,
              recipientSessionId: draft.selected!.sessionId,
              message: draft.message,
              items: toItems(draft.items),
              showSenderTable: draft.showSenderTable,
            };
            void send({ url: '/gifts', payload, key: payload.requestId });
          }}
        />
      )}
      <ProductDetailModal
        product={product}
        toppings={menu.data?.toppings ?? []}
        onClose={() => setProduct(null)}
        onAdded={() => setProduct(null)}
        onAdd={(item) => (addItem(item) ? undefined : false)}
      />
      <AISheet
        open={aiOpen}
        onOpenChange={setAiOpen}
        products={menu.data?.products ?? []}
        toppings={menu.data?.toppings ?? []}
        onAdd={(item) => void addItem(item)}
      />
      <GiftQuoteModal
        quote={quote}
        locked={locked}
        onClose={() => setQuote(null)}
        onConfirm={(q) =>
          void send({
            url: '/orders',
            key: generateRequestId(),
            payload: {
              giftId: q.gift.id,
              items: toItems(q.gift.items),
              quoteToken: q.quote.quoteToken,
            },
          })
        }
      />
    </div>
  );
}
