import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessageSquareText, Star } from 'lucide-react';
import { api, getErrorMessage, unwrap, vnd } from '../../lib/api';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { EmptyState, ErrorState } from '../../components/ui/EmptyState';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';
import { Skeleton } from '../../components/ui/Skeleton';

interface ReviewItem {
  _id: string;
  rating: number;
  comment: string;
  createdAt: string;
  orderCode?: string;
  orderTotal?: number;
  tableName?: string;
}

interface ReviewsResponse {
  items: ReviewItem[];
  total: number;
  page: number;
  limit: number;
  averageRating: number;
  distribution: Array<{ rating: number; count: number }>;
}

export function AdminReviews(): JSX.Element {
  useDocumentTitle('Đánh giá khách hàng');
  const [rating, setRating] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [filters, setFilters] = useState({ rating: '', from: '', to: '', page: 1 });
  const params = new URLSearchParams();
  if (filters.rating) params.set('rating', filters.rating);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  params.set('page', String(filters.page));
  const reviewsQuery = useQuery({
    queryKey: ['admin-reviews', filters],
    queryFn: async () => unwrap(await api.get<ReviewsResponse>(`/admin/reviews?${params.toString()}`)),
  });

  function applyFilters(event: React.FormEvent): void {
    event.preventDefault();
    setFilters({ rating, from, to, page: 1 });
  }

  if (reviewsQuery.isLoading) return <Skeleton className="h-80" />;
  if (reviewsQuery.isError) return <ErrorState message={getErrorMessage(reviewsQuery.error)} onRetry={() => reviewsQuery.refetch()} />;
  const data = reviewsQuery.data!;
  const maxCount = Math.max(...data.distribution.map((item) => item.count), 1);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-semibold">Đánh giá khách hàng</h1>
        <p className="text-sm text-muted-foreground">Phản hồi do khách gửi sau khi đơn đã được thanh toán.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[240px,1fr] gap-3">
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Điểm trung bình</p>
          <p className="mt-1 flex items-center gap-2 font-display text-3xl font-semibold">
            <Star className="h-6 w-6 fill-accent text-accent" /> {data.total ? data.averageRating.toFixed(1) : '—'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{data.total} đánh giá theo bộ lọc hiện tại</p>
        </Card>
        <Card className="p-4 space-y-2">
          <p className="text-sm font-semibold">Phân bố số sao</p>
          {data.distribution.slice().reverse().map((item) => (
            <div key={item.rating} className="flex items-center gap-2 text-xs">
              <span className="w-10 flex items-center gap-1">{item.rating} <Star className="h-3 w-3 fill-accent text-accent" /></span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-accent" style={{ width: `${(item.count / maxCount) * 100}%` }} /></div>
              <span className="w-8 text-right">{item.count}</span>
            </div>
          ))}
        </Card>
      </div>

      <Card className="p-4">
        <form className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end" onSubmit={applyFilters}>
          <label className="text-sm">Số sao
            <select value={rating} onChange={(event) => setRating(event.target.value)} className="mt-1 w-full rounded-lg border border-foreground/15 bg-card p-2">
              <option value="">Tất cả</option>
              {[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{value} sao</option>)}
            </select>
          </label>
          <label className="text-sm">Từ ngày<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="mt-1 w-full rounded-lg border border-foreground/15 bg-card p-2" /></label>
          <label className="text-sm">Đến ngày<input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} className="mt-1 w-full rounded-lg border border-foreground/15 bg-card p-2" /></label>
          <div className="flex gap-2"><Button type="submit">Lọc</Button><Button type="button" variant="outline" onClick={() => { setRating(''); setFrom(''); setTo(''); setFilters({ rating: '', from: '', to: '', page: 1 }); }}>Xóa lọc</Button></div>
        </form>
      </Card>

      {data.items.length === 0 ? (
        <EmptyState icon={<MessageSquareText className="h-6 w-6" />} title="Chưa có đánh giá phù hợp" description="Đánh giá sẽ xuất hiện sau khi khách thanh toán và gửi phản hồi." />
      ) : (
        <div className="space-y-3">
          {data.items.map((review) => <Card key={review._id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex items-center gap-1 text-accent" aria-label={`${review.rating} trên 5 sao`}>
                {Array.from({ length: 5 }, (_, index) => <Star key={index} className={`h-4 w-4 ${index < review.rating ? 'fill-current' : 'text-muted fill-none'}`} />)}
                <span className="ml-1 text-sm font-semibold text-foreground">{review.rating}/5</span>
              </div>
              <p className="text-xs text-muted-foreground">{new Date(review.createdAt).toLocaleString('vi-VN')}</p>
            </div>
            <p className="mt-3 text-sm whitespace-pre-wrap">{review.comment || 'Khách không để lại nhận xét.'}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <Badge tone="neutral">{review.tableName ?? 'Bàn không còn dữ liệu'}</Badge>
              <span>Đơn {review.orderCode ?? '—'}</span>
              {typeof review.orderTotal === 'number' ? <span>{vnd(review.orderTotal)}</span> : null}
            </div>
          </Card>)}
        </div>
      )}
      {data.total > data.limit ? <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">Trang {data.page} / {Math.ceil(data.total / data.limit)}</p>
        <div className="flex gap-2"><Button size="sm" variant="outline" disabled={data.page === 1} onClick={() => setFilters((current) => ({ ...current, page: current.page - 1 }))}>Trước</Button><Button size="sm" variant="outline" disabled={data.page * data.limit >= data.total} onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))}>Sau</Button></div>
      </div> : null}
    </div>
  );
}
