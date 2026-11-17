import type { UseQueryResult } from '@tanstack/react-query';
import type { GiftTable, MenuProduct } from '@may-cafe/contracts';
import { getErrorMessage, vnd } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { MenuPhoto } from '../guest/MenuPhoto';
import { CupPhotoPicker } from '../cupPhotos/CupPhotoPicker';
import type { GiftDraft } from './useGiftDraft';

interface Props {
  draft: GiftDraft;
  tables: UseQueryResult<{ items: GiftTable[] }>;
  menuError: unknown;
  menuLoading: boolean;
  availableProducts: MenuProduct[];
  targetValid: boolean | undefined;
  /** Khóa toàn bộ form khi đang gửi, có request chờ thử lại hoặc đang kiểm giá. */
  formDisabled: boolean;
  locked: boolean;
  onPickProduct: (product: MenuProduct) => void;
  onOpenAi: () => void;
  onPhotoBusy: (key: string, busy: boolean) => void;
  onSend: () => void;
}

export function GiftComposer({
  draft,
  tables,
  menuError,
  menuLoading,
  availableProducts,
  targetValid,
  formDisabled,
  locked,
  onPickProduct,
  onOpenAi,
  onPhotoBusy,
  onSend,
}: Props): JSX.Element {
  const { selected, items, limit, showSenderTable } = draft;
  return (
    <Card className="space-y-4 p-4 sm:p-6">
      <h2 className="text-xl font-semibold">Gửi quà</h2>
      <fieldset disabled={formDisabled} className="space-y-4">
        <legend className="mb-2 font-semibold">1. Chọn bàn nhận</legend>
        {tables.isError && <p role="alert">{getErrorMessage(tables.error)}</p>}
        <div
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
          aria-label="Sơ đồ chọn bàn nhận"
        >
          {tables.data?.items.map((t) => (
            <button
              key={t.tableId}
              type="button"
              disabled={!t.available}
              aria-pressed={selected?.tableId === t.tableId && targetValid}
              onClick={() => draft.setSelected(t)}
              className={`min-h-20 rounded-2xl border p-3 text-left disabled:opacity-40 ${selected?.tableId === t.tableId && targetValid ? 'border-primary bg-primary/15' : 'border-control'}`}
            >
              <strong className="block">{t.name}</strong>
              <span className="text-xs">{t.available ? 'Có thể nhận quà' : 'Chưa nhận quà'}</span>
            </button>
          ))}
        </div>
        {selected && !targetValid && <p role="alert">Bàn nhận vừa thay đổi. Hãy chọn lại bàn.</p>}
        <label className="block font-semibold">
          2. Chọn món
          <input
            className="mt-2 block w-full rounded-xl border bg-background p-3 font-normal"
            placeholder="Tìm món"
            aria-label="Tìm món tặng"
            value={draft.search}
            onChange={(e) => {
              draft.setSearch(e.target.value);
              draft.setLimit(6);
            }}
          />
        </label>
        {!!menuError && <p role="alert">{getErrorMessage(menuError)}</p>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {availableProducts.slice(0, limit).map((p) => (
            <button
              key={p._id}
              type="button"
              onClick={() => onPickProduct(p)}
              className="overflow-hidden rounded-2xl border border-control text-left"
            >
              <MenuPhoto source={p.image} className="aspect-[4/3] !h-auto w-full" />
              <span className="block p-3">
                <strong className="block">{p.name}</strong>
                <span className="text-sm">
                  {vnd(p.variants.find((v) => v.isAvailable !== false)?.price ?? p.basePrice)} · +
                </span>
              </span>
            </button>
          ))}
        </div>
        {!menuLoading && !availableProducts.length && <p>Không có món phù hợp.</p>}
        {availableProducts.length > limit && (
          <Button variant="outline" onClick={() => draft.setLimit((n) => n + 6)}>
            Xem thêm món
          </Button>
        )}
        <Button variant="outline" disabled={locked} onClick={onOpenAi}>
          AI Barista
        </Button>
        {!!items.length && (
          <div className="space-y-2 rounded-xl bg-background/50 p-3">
            {items.map((i, index) => (
              <div key={index} className="space-y-2">
                <span>
                  {i.quantity} × {i.name} {i.variantName} · {vnd(i.unitPrice * i.quantity)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => draft.setItems((values) => values.filter((_, n) => n !== index))}
                  aria-label={`Bỏ ${i.name}`}
                  disabled={locked}
                >
                  Bỏ
                </Button>
                <CupPhotoPicker
                  label={`Ảnh quà ${i.name}`}
                  photoId={i.cupPhotoId}
                  disabled={formDisabled}
                  onBusyChange={(value) => onPhotoBusy(String(index), value)}
                  onChange={(cupPhotoId) =>
                    draft.setItems((v) => v.map((x, n) => (n === index ? { ...x, cupPhotoId } : x)))
                  }
                />
              </div>
            ))}
          </div>
        )}
        <label className="block font-semibold">
          3. Lời nhắn
          <textarea
            value={draft.message}
            maxLength={140}
            onChange={(e) => draft.setMessage(e.target.value)}
            className="mt-2 block w-full rounded-xl border bg-background p-3 font-normal"
            placeholder="Chúc bạn một ngày vui!"
          />
        </label>
        <fieldset className="space-y-2">
          <legend className="mb-2 font-semibold">Hiển thị người gửi</legend>
          <label className="flex min-h-11 items-center gap-3 rounded-xl border p-3">
            <input
              type="radio"
              name="senderVisibility"
              checked={!showSenderTable}
              onChange={() => draft.setShowSenderTable(false)}
            />
            Ẩn danh
          </label>
          <label className="flex min-h-11 items-center gap-3 rounded-xl border p-3">
            <input
              type="radio"
              name="senderVisibility"
              checked={showSenderTable}
              onChange={() => draft.setShowSenderTable(true)}
            />
            Hiện bàn gửi
          </label>
        </fieldset>
        <Button disabled={locked || !targetValid || !items.length} onClick={onSend}>
          Gửi lời mời tặng quà
        </Button>
      </fieldset>
    </Card>
  );
}
