import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sparkles, Send } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { api, getErrorMessage, unwrap, vnd } from '../../lib/api';
import { useToast } from '../../components/ui/useToast';
import { EmptyState, ErrorState } from '../../components/ui/EmptyState';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';
import { Skeleton } from '../../components/ui/Skeleton';
import type { ReactNode } from 'react';
import { ProductDetailModal, type Product as MenuProduct, type Topping } from '../guest/ProductDetailModal';

interface Recommendation {
  productId: string;
  variantId: string | null;
  reason: string;
  unitPrice: number;
  name: string;
  image: string;
}

interface AIRecommendResponse {
  mode: 'llm' | 'fallback';
  message: string;
  recommendations: Recommendation[];
  followUpQuestion?: string;
  latencyMs?: number;
}

interface MenuResponse {
  categories: Array<{ _id: string; name: string }>;
  products: MenuProduct[];
  toppings: Array<{ _id: string; name: string; price: number }>;
}

const PRESETS = [
  'Mình thích vị chua nhẹ, không uống cà phê, muốn ít ngọt, dưới 50 nghìn.',
  'Gợi ý món ít ngọt cho người mới uống.',
  'Đồ uống không có sữa, có vị trái cây.',
  'Món signature nổi bật nhất hôm nay?',
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: MenuProduct[];
  toppings?: Topping[];
  children?: ReactNode;
}

export function AISheet({ open, onOpenChange, products, toppings = [] }: Props): JSX.Element {
  useDocumentTitle('AI Barista');
  const [prompt, setPrompt] = useState(PRESETS[0] ?? '');
  const [busy, setBusy] = useState(false);
  const [response, setResponse] = useState<AIRecommendResponse | null>(null);
  const { toast } = useToast();
  const [selected, setSelected] = useState<MenuProduct | null>(null);
  const [budget, setBudget] = useState('');
  const [noCaffeine, setNoCaffeine] = useState(false);
  const [noDairy, setNoDairy] = useState(false);

  async function ask(): Promise<void> {
    setBusy(true);
    try {
      const data = await unwrap<AIRecommendResponse>(await api.post('/ai/recommendations', {
        prompt, ...(budget ? { maxBudget: Number(budget) } : {}), preferences: { noCaffeine, noDairy },
      }));
      setResponse(data);
    } catch (e) {
      toast({ title: 'AI chưa phản hồi', description: getErrorMessage(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  function addRec(rec: Recommendation): void {
    const product = products.find((p) => p._id === rec.productId);
    if (!product) return;
    setSelected(product);
    onOpenChange(false);
  }

  return (
    <><Modal
      open={open}
      onOpenChange={onOpenChange}
      title="AI Barista"
      description="Mô tả khẩu vị, AI sẽ gợi ý món phù hợp từ thực đơn."
    >
      <div className="space-y-3">
        <label className="block text-sm">Ngân sách mỗi món (VND)
          <input type="number" min="1000" step="1000" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="Ví dụ: 50000" className="mt-1 w-full border rounded-xl p-2" />
        </label>
        <div className="flex flex-wrap gap-4 text-sm">
          <label><input type="checkbox" checked={noCaffeine} onChange={(e) => setNoCaffeine(e.target.checked)} /> Không caffeine</label>
          <label><input type="checkbox" checked={noDairy} onChange={(e) => setNoDairy(e.target.checked)} /> Không sữa</label>
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          maxLength={500}
          className="w-full rounded-xl border border-foreground/15 bg-white p-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
          placeholder="Bạn thích vị gì? Ngân sách bao nhiêu?"
        />
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => setPrompt(p)}
              className="rounded-full border border-foreground/10 px-3 py-1 text-xs hover:bg-muted"
            >
              {p.length > 32 ? `${p.slice(0, 32)}…` : p}
            </button>
          ))}
        </div>
        <Button className="w-full" onClick={() => void ask()} disabled={busy || prompt.trim().length === 0}>
          <Send className="h-4 w-4" /> {busy ? 'AI đang phản hồi...' : 'Hỏi AI'}
        </Button>

        {response ? (
          <div className="space-y-3 rounded-2xl bg-muted p-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <p className="text-sm">{response.message}</p>
              <Badge tone={response.mode === 'llm' ? 'success' : 'warning'} className="ml-auto">
                {response.mode === 'llm' ? 'AI' : 'Gợi ý theo menu'}
              </Badge>
            </div>
            {response.recommendations.map((rec) => (
              <button
                key={`${rec.productId}-${rec.variantId ?? ''}`}
                className="card flex w-full overflow-hidden text-left hover:shadow-md"
                onClick={() => addRec(rec)}
              >
                <img src={rec.image} alt={rec.name} className="h-20 w-20 object-cover" />
                <div className="flex-1 p-3">
                  <p className="font-display font-semibold">{rec.name}</p>
                  <p className="text-xs text-muted-foreground">{rec.reason}</p>
                  <p className="mt-1 text-sm font-semibold">{vnd(rec.unitPrice)}</p>
                </div>
              </button>
            ))}
            {response.followUpQuestion ? (
              <p className="text-xs text-muted-foreground">{response.followUpQuestion}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
    <ProductDetailModal product={selected} toppings={toppings} onClose={() => setSelected(null)} onAdded={() => setSelected(null)} />
    </>
  );
}

export function AIPage(): JSX.Element {
  const [open, setOpen] = useState(true);
  const menuQuery = useQuery({
    queryKey: ['menu'],
    queryFn: async () => unwrap<MenuResponse>(await api.get('/categories')),
  });

  if (menuQuery.isLoading) {
    return <Skeleton className="h-64" />;
  }
  if (menuQuery.isError) {
    return <ErrorState message={getErrorMessage(menuQuery.error)} onRetry={() => menuQuery.refetch()} />;
  }

  return (
    <div>
      <AISheet open={open} onOpenChange={setOpen} products={menuQuery.data?.products ?? []} toppings={menuQuery.data?.toppings ?? []} />
      {!open ? (
        <EmptyState
          title="AI Barista đã đóng"
          description="Mở lại bằng cách vào menu và bấm Hỏi AI Barista."
          action={<Button onClick={() => setOpen(true)}>Mở AI Barista</Button>}
        />
      ) : null}
    </div>
  );
}
