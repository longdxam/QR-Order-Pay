import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap, vnd, getErrorMessage } from '../../lib/api';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { EmptyState, ErrorState } from '../../components/ui/EmptyState';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';
import { useToast } from '../../components/ui/useToast';
import { receiptResponseSchema, type ReceiptResponse } from '@may-cafe/contracts';

type ReceiptOrder = ReceiptResponse['orders'][number];

export function ReceiptPage(): JSX.Element {
  useDocumentTitle('Hóa đơn & đánh giá');
  const query = useQuery({
    queryKey: ['receipt'],
    queryFn: async () =>
      receiptResponseSchema.parse(unwrap(await api.get<unknown>('/receipts/current'))),
    retry: false,
  });
  if (query.isLoading) return <p>Đang tải hóa đơn...</p>;
  if (query.isError)
    return <ErrorState message={getErrorMessage(query.error)} onRetry={() => query.refetch()} />;
  const data = query.data!;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between gap-3 items-center">
        <div>
          <h1 className="font-display text-2xl font-semibold">Hóa đơn của bạn</h1>
          <p className="text-sm text-muted-foreground">
            Mây Café · {data.tableName} · Đã kết thúc phiên
          </p>
        </div>
        <Button variant="outline" className="print:hidden" onClick={() => window.print()}>
          In hóa đơn
        </Button>
      </div>
      <p className="text-sm">Các món do thiết bị này đặt. Nhân viên thu tiền chung theo bàn.</p>
      {data.orders.length === 0 ? (
        <EmptyState
          title="Không có món đã thanh toán"
          description="Phiên đã đóng; thiết bị này không có đơn đã thanh toán."
        />
      ) : (
        data.orders.map((order) => (
          <Card key={order._id} className="p-4 space-y-3 break-inside-avoid">
            <h2 className="font-semibold">Đơn {order.code}</h2>
            {order.items.map((item, i) => (
              <div key={i} className="flex justify-between gap-4 text-sm">
                <div>
                  <p>
                    {item.quantity} × {item.nameSnapshot}
                    {item.sizeName ? ` (${item.sizeName})` : ''}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Đường {item.sugarLevel} ·{' '}
                    {item.iceLevel === 'no-ice'
                      ? 'Không đá'
                      : item.iceLevel === 'less-ice'
                        ? 'Ít đá'
                        : 'Đá thường'}
                  </p>
                  {item.toppingNamesSnapshot?.length ? (
                    <p className="text-xs">{item.toppingNamesSnapshot.join(', ')}</p>
                  ) : null}
                  {item.note ? <p className="text-xs italic">{item.note}</p> : null}
                </div>
                <span className="whitespace-nowrap">{vnd(item.lineTotal)}</span>
              </div>
            ))}
            <p className="font-semibold text-right">{vnd(order.total)} · Đã thanh toán</p>
            <div className="print:hidden">
              <ReviewForm order={order} />
            </div>
          </Card>
        ))
      )}
      <p className="text-xl font-semibold text-right">Tổng đã thanh toán: {vnd(data.total)}</p>
      <p className="text-sm text-muted-foreground">
        Cảm ơn bạn đã ghé Mây Café! Quyền xem hóa đơn trên thiết bị này hết hạn sau 12 giờ kể từ lúc
        vào bàn hoặc khi bạn rời bàn.
      </p>
    </div>
  );
}

function ReviewForm({ order }: { order: ReceiptOrder }): JSX.Element {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const qc = useQueryClient();
  const { toast } = useToast();
  const review = useMutation({
    mutationFn: () => api.post(`/receipts/orders/${order._id}/review`, { rating, comment }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['receipt'] });
      toast({ title: 'Cảm ơn bạn đã đánh giá!', tone: 'success' });
    },
    onError: (e) =>
      toast({ title: 'Chưa gửi được đánh giá', description: getErrorMessage(e), tone: 'danger' }),
  });
  if (order.review)
    return (
      <p className="text-sm text-primary">
        Bạn đã đánh giá {order.review.rating}/5 sao
        {order.review.comment ? ` — ${order.review.comment}` : ''}
      </p>
    );
  return (
    <form
      className="border-t pt-3 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        review.mutate();
      }}
    >
      <label className="text-sm block">
        Đánh giá đồ uống
        <select
          aria-label={`Số sao cho đơn ${order.code}`}
          value={rating}
          onChange={(e) => setRating(Number(e.target.value))}
          className="ml-3 border rounded p-2"
        >
          {[5, 4, 3, 2, 1].map((n) => (
            <option key={n} value={n}>
              {n} sao
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        Nhận xét (không bắt buộc)
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={500}
          rows={2}
          className="mt-1 w-full rounded-xl border p-3"
        />
      </label>
      <Button type="submit" disabled={review.isPending || review.isSuccess}>
        {review.isPending ? 'Đang gửi...' : 'Gửi đánh giá'}
      </Button>
    </form>
  );
}
