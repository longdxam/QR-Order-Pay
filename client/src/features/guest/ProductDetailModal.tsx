import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { vnd } from '../../lib/api';
import { useCart } from '../../store/cart';
import { useToast } from '../../components/ui/Toast';

interface Variant {
  _id: string;
  name: string;
  price: number;
  isAvailable?: boolean;
}

export interface Product {
  _id: string;
  name: string;
  description: string;
  image: string;
  basePrice: number;
  variants: Variant[];
  allowedOptions: {
    sizes: string[];
    sugarLevels: string[];
    iceLevels: string[];
    toppingIds: string[];
  };
  toppingIds: string[];
  tags: string[];
  isAvailable: boolean;
}

export interface Topping {
  _id: string;
  name: string;
  price: number;
  isAvailable?: boolean;
}

interface Props {
  product: Product | null;
  toppings: Topping[];
  onClose: () => void;
  onAdded: () => void;
}

const SUGAR_LEVELS = ['0%', '30%', '50%', '70%', '100%'];
const ICE_LEVELS = [
  { value: 'no-ice', label: 'Không đá' },
  { value: 'less-ice', label: 'Ít đá' },
  { value: 'normal-ice', label: 'Đá thường' },
];

export function ProductDetailModal({ product, toppings, onClose, onAdded }: Props): JSX.Element {
  const addToCart = useCart((s) => s.add);
  const { toast } = useToast();

  const availableSizes = useMemo(() => {
    if (!product) return [] as string[];
    if (product.allowedOptions.sizes?.length > 0) return product.allowedOptions.sizes;
    return product.variants.map((v) => v.name);
  }, [product]);

  const initialVariant = useMemo(() => {
    if (!product) return null;
    if (product.variants.length === 0) return null;
    return product.variants.find((v) => v.isAvailable !== false && product.allowedOptions.sizes.includes(v.name)) ?? null;
  }, [product]);

  const [variantId, setVariantId] = useState<string | null>(initialVariant?._id ?? null);
  const [sugar, setSugar] = useState<string>('50%');
  const [ice, setIce] = useState<string>('normal-ice');
  const [toppingIds, setToppingIds] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    if (product) {
      setVariantId(initialVariant?._id ?? null);
      setSugar(product.allowedOptions.sugarLevels.includes('50%') ? '50%' : product.allowedOptions.sugarLevels[0] ?? '');
      setIce(product.allowedOptions.iceLevels.includes('normal-ice') ? 'normal-ice' : product.allowedOptions.iceLevels[0] ?? '');
      setToppingIds([]);
      setNote('');
      setQuantity(1);
    }
  }, [product, initialVariant]);

  if (!product) {
    return <></>;
  }

  const variant = product.variants.find((v) => v._id === variantId) ?? null;
  const unitPrice =
    (variant?.price ?? product.basePrice) +
    toppingIds.reduce((sum, id) => sum + (toppings.find((t) => t._id === id)?.price ?? 0), 0);

  function toggleTopping(id: string): void {
    setToppingIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function handleAdd(): void {
    addToCart({
      productId: product!._id,
      variantId: variant?._id ?? null,
      sizeName: variant?.name ?? null,
      sugarLevel: sugar,
      iceLevel: ice,
      toppingIds,
      note,
      quantity,
      unitPrice,
      name: product!.name,
      variantName: variant?.name ?? '',
      image: product!.image,
    });
    toast({ title: 'Đã thêm vào giỏ', description: `${quantity} x ${product!.name}`, tone: 'success' });
    onAdded();
  }

  return (
    <Modal open={!!product} onOpenChange={(o) => !o && onClose()} title={product.name}>
      <div className="grid grid-cols-1 sm:grid-cols-[160px,1fr] gap-4">
        <img src={product.image} alt={product.name} className="rounded-xl h-32 w-full object-cover" />
        <div>
          <p className="text-sm text-muted-foreground">{product.description}</p>
          {!product.isAvailable ? (
            <Badge tone="danger" className="mt-2">
              Món đang tạm hết
            </Badge>
          ) : null}
        </div>
      </div>

      {availableSizes.length > 0 ? (
        <Section title="Size">
          <div className="flex flex-wrap gap-2">
            {product.variants.map((v) => (
              <button
                key={v._id}
                disabled={v.isAvailable === false || !product.allowedOptions.sizes.includes(v.name)}
                className={`rounded-full border px-3 py-1.5 text-sm transition ${
                  variantId === v._id ? 'bg-primary text-primary-foreground border-primary' : 'border-foreground/15 hover:bg-muted'
                }`}
                onClick={() => setVariantId(v._id)}
              >
                {v.name} · {vnd(v.price)}
              </button>
            ))}
          </div>
        </Section>
      ) : null}

      <Section title="Đường">
        <div className="flex flex-wrap gap-2">
          {(product.allowedOptions.sugarLevels?.length > 0 ? product.allowedOptions.sugarLevels : SUGAR_LEVELS).map((s) => (
            <button
              key={s}
              className={`rounded-full border px-3 py-1.5 text-sm transition ${
                sugar === s ? 'bg-primary text-primary-foreground border-primary' : 'border-foreground/15 hover:bg-muted'
              }`}
              onClick={() => setSugar(s)}
            >
              {s}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Đá">
        <div className="flex flex-wrap gap-2">
          {(product.allowedOptions.iceLevels?.length > 0
            ? product.allowedOptions.iceLevels.map((v) => ({ value: v, label: ICE_LEVELS.find((i) => i.value === v)?.label ?? v }))
            : ICE_LEVELS
          ).map((i) => (
            <button
              key={i.value}
              className={`rounded-full border px-3 py-1.5 text-sm transition ${
                ice === i.value ? 'bg-primary text-primary-foreground border-primary' : 'border-foreground/15 hover:bg-muted'
              }`}
              onClick={() => setIce(i.value)}
            >
              {i.label}
            </button>
          ))}
        </div>
      </Section>

      {toppings.length > 0 && product.allowedOptions.toppingIds?.length > 0 ? (
        <Section title="Topping">
          <div className="flex flex-wrap gap-2">
            {toppings
              .filter((t) => t.isAvailable !== false && product.allowedOptions.toppingIds.includes(t._id))
              .map((t) => (
                <button
                  key={t._id}
                  className={`rounded-full border px-3 py-1.5 text-sm transition ${
                    toppingIds.includes(t._id) ? 'bg-accent text-accent-foreground border-accent' : 'border-foreground/15 hover:bg-muted'
                  }`}
                  onClick={() => toggleTopping(t._id)}
                >
                  {t.name} · {vnd(t.price)}
                </button>
              ))}
          </div>
        </Section>
      ) : null}

      <Section title="Ghi chú">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={280}
          rows={2}
          placeholder="Ví dụ: ít ngọt hơn, đổi sang sữa hạnh nhân..."
          className="w-full rounded-xl border border-foreground/15 bg-white p-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </Section>

      <Section title="Số lượng">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={() => setQuantity((q) => Math.max(1, q - 1))}>
            −
          </Button>
          <span className="text-lg font-semibold w-8 text-center">{quantity}</span>
          <Button variant="outline" size="icon" onClick={() => setQuantity((q) => Math.min(50, q + 1))}>
            +
          </Button>
          <span className="ml-auto font-semibold">{vnd(unitPrice * quantity)}</span>
        </div>
      </Section>

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Hủy
        </Button>
        <Button onClick={handleAdd} disabled={!product.isAvailable || !sugar || !ice || (product.variants.length > 0 && !variant)}>
          Thêm vào giỏ
        </Button>
      </div>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="mt-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{title}</p>
      {children}
    </div>
  );
}
