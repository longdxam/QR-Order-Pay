import { useQuery } from '@tanstack/react-query';
import { Card } from '../../components/ui/Card';
import { api, getErrorMessage, unwrap, vnd } from '../../lib/api';
import { Badge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Skeleton';
import { ErrorState, useDocumentTitle } from '../../components/ui/EmptyState';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, LineChart, Line, CartesianGrid } from 'recharts';
import { useMemo } from 'react';

interface Overview {
  totalRevenue: number;
  orderCount: number;
  averageOrderValue: number;
  topProducts: Array<{ productId: string; name: string; quantity: number; revenue: number }>;
  revenueByDay: Array<{ date: string; revenue: number; orders: number }>;
  revenueByHour: Array<{ hour: number; revenue: number }>;
}

export function AdminDashboard(): JSX.Element {
  useDocumentTitle('Dashboard');
  const overviewQuery = useQuery({
    queryKey: ['admin-overview'],
    queryFn: async () => unwrap(await api.get<Overview>('/admin/reports/overview')),
    refetchInterval: 60_000,
  });

  const totalTop = useMemo(() => overviewQuery.data?.topProducts ?? [], [overviewQuery.data]);

  if (overviewQuery.isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
    );
  }
  if (overviewQuery.isError) {
    return <ErrorState message={getErrorMessage(overviewQuery.error)} onRetry={() => overviewQuery.refetch()} />;
  }
  const data = overviewQuery.data!;
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-semibold">Tổng quan 30 ngày</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard title="Doanh thu" value={vnd(data.totalRevenue)} tone="success" />
        <KpiCard title="Số đơn" value={data.orderCount.toString()} tone="info" />
        <KpiCard title="Giá trị TB/đơn" value={vnd(data.averageOrderValue)} tone="success" />
        <KpiCard title="Sản phẩm bán chạy" value={(data.topProducts[0]?.name ?? '—')} tone="warning" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card className="p-4">
          <h3 className="font-display font-semibold">Doanh thu theo ngày</h3>
          <div className="h-72 mt-3">
            <ResponsiveContainer>
              <LineChart data={data.revenueByDay}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EFEAE2" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => vnd(v)} />
                <Line type="monotone" dataKey="revenue" stroke="#285943" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="font-display font-semibold">Doanh thu theo giờ</h3>
          <div className="h-72 mt-3">
            <ResponsiveContainer>
              <BarChart data={data.revenueByHour}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EFEAE2" />
                <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => vnd(v)} />
                <Bar dataKey="revenue" fill="#C88A4D" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card className="p-4">
        <h3 className="font-display font-semibold mb-2">Top 5 sản phẩm</h3>
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="text-left">
              <th className="py-2">Sản phẩm</th>
              <th className="py-2">Số lượng</th>
              <th className="py-2">Doanh thu</th>
            </tr>
          </thead>
          <tbody>
            {totalTop.map((p) => (
              <tr key={p.productId} className="border-t border-foreground/5">
                <td className="py-2 font-medium">{p.name}</td>
                <td className="py-2">{p.quantity}</td>
                <td className="py-2">{vnd(p.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function KpiCard({ title, value, tone }: { title: string; value: string; tone: 'info' | 'success' | 'warning' }): JSX.Element {
  return (
    <Card className="p-4 space-y-1">
      <Badge tone={tone}>{title}</Badge>
      <p className="font-display text-2xl font-semibold">{value}</p>
    </Card>
  );
}
