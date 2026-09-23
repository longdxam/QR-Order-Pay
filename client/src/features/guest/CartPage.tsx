import { useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CurrentTableSessionResponse } from '@may-cafe/contracts';
import { getAxiosError } from '../../lib/api';
import { Trash2, ShoppingBag } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { useCart, cartTotals } from '../../store/cart';
import { api, generateIdempotencyKey, getErrorMessage, unwrap, vnd } from '../../lib/api';
import { useToast } from '../../components/ui/useToast';
import { EmptyState } from '../../components/ui/EmptyState';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';

export function CartPage(): JSX.Element {
  useDocumentTitle('Giỏ hàng');
  const navigate = useNavigate();
  const items = useCart((s) => s.items);
  const remove = useCart((s) => s.remove);
  const update = useCart((s) => s.update);
  const clear = useCart((s) => s.clear);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const submission = useRef<{ payload: string; key: string } | null>(null);
  const sessionQuery = useQuery({
    queryKey: ['guest-session'],
    queryFn: async () =>
      unwrap(await api.get<CurrentTableSessionResponse>('/table-sessions/current')),
  });

  const { subtotal } = cartTotals(items);

  const placeMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        items: items.map((it) => ({
          productId: it.productId,
          variantId: it.variantId,
          sugarLevel: it.sugarLevel,
          iceLevel: it.iceLevel,
          toppingIds: it.toppingIds,
          note: it.note,
          quantity: it.quantity,
        })),
      };
      const signature = JSON.stringify({ session: useCart.getState().tableSessionId, payload });
      if (submission.current?.payload !== signature)
        submission.current = { payload: signature, key: generateIdempotencyKey() };
      return unwrap(
        await api.post('/orders', payload, {
          headers: { 'Idempotency-Key': submission.current.key },
        }),
      );
    },
    onSuccess: () => {
      toast({
        title: 'Đã gửi đơn tới bếp',
        description: 'Bạn có thể theo dõi tiến độ ở trang Đơn.',
        tone: 'success',
      });
      clear();
      submission.current = null;
      queryClient.invalidateQueries({ queryKey: ['my-orders'] });
      navigate('/orders');
    },
    onError: (err) => {
      const status = getAxiosError(err)?.response?.status;
      if (status && status < 500) submission.current = null;
      toast({ title: 'Không gửi được đơn', description: getErrorMessage(err), tone: 'danger' });
    },
  });

  const groupedItems = useMemo(() => items, [items]);

  if (groupedItems.length === 0) {
    return (
      <EmptyState
        title="Giỏ hàng trống"
        description="Hãy quay lại thực đơn và chọn món bạn thích."
        icon={<ShoppingBag className="h-6 w-6" />}
        action={
          <Button variant="primary" onClick={() => navigate('/menu')}>
            Xem menu
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-semibold">Giỏ hàng của bạn</h1>
      <fieldset disabled={placeMutation.isPending} className="space-y-3">
        {groupedItems.map((it) => (
          <Card key={it.clientId} className="p-3 flex gap-3">
            <img src={it.image} alt={it.name} className="h-20 w-20 rounded-xl object-cover" />
            <div className="flex-1">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-display font-semibold">{it.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {it.variantName ? `${it.variantName} · ` : ''}
                    Đường {it.sugarLevel} · Đá {labelIce(it.iceLevel)}
                  </p>
                  {it.toppingIds.length > 0 ? (
                    <p className="text-xs text-muted-foreground">Topping: {it.toppingIds.length}</p>
                  ) : null}
                  {it.note ? (
                    <p className="text-xs italic text-muted-foreground">"{it.note}"</p>
                  ) : null}
                </div>
                <button
                  onClick={() => remove(it.clientId)}
                  className="text-muted-foreground hover:text-danger"
                  aria-label="Xoá món"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <div className="inline-flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => update(it.clientId, { quantity: Math.max(1, it.quantity - 1) })}
                  >
                    −
                  </Button>
                  <span className="w-6 text-center text-sm">{it.quantity}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => update(it.clientId, { quantity: Math.min(50, it.quantity + 1) })}
                  >
                    +
                  </Button>
                </div>
                <p className="font-semibold">{vnd(it.unitPrice * it.quantity)}</p>
              </div>
            </div>
          </Card>
        ))}
      </fieldset>

      <Card className="p-4 space-y-2">
        <div className="flex justify-between text-sm">
          <span>Tạm tính</span>
          <span className="font-semibold">{vnd(subtotal)}</span>
        </div>
        <div className="flex justify-between text-sm text-muted-foreground">
          <span>Phụ phí</span>
          <span>0₫</span>
        </div>
        <div className="border-t border-foreground/10 pt-2 flex justify-between font-display text-base">
          <span>Tổng</span>
          <span>{vnd(subtotal)}</span>
        </div>
        {sessionQuery.data?.active && sessionQuery.data.status === 'CHECKOUT' ? (
          <p className="text-sm text-muted-foreground">
            Bàn đang thanh toán, vui lòng nhờ nhân viên mở lại để gọi thêm món.
          </p>
        ) : null}
        <Button
          className="w-full"
          onClick={() => placeMutation.mutate()}
          disabled={
            placeMutation.isPending ||
            !sessionQuery.data?.active ||
            sessionQuery.data.status !== 'OPEN'
          }
        >
          {placeMutation.isPending ? 'Đang gửi đơn...' : 'Gửi đơn tới bếp'}
        </Button>
      </Card>
    </div>
  );
}

function labelIce(v: string): string {
  return v === 'no-ice' ? 'không đá' : v === 'less-ice' ? 'ít đá' : 'đá thường';
}
