import { useQuery } from '@tanstack/react-query';
import { Card } from '../../components/ui/Card';
import { api, getErrorMessage, unwrap, vnd } from '../../lib/api';
import { Badge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Skeleton';
import { ErrorState } from '../../components/ui/EmptyState';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  LineChart,
  Line,
  CartesianGrid,
} from 'recharts';
import { useMemo, useState } from 'react';
import type { DashboardOverview } from '@may-cafe/contracts';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Download, Printer } from 'lucide-react';

export function AdminDashboard(): JSX.Element {
  useDocumentTitle('Dashboard');
  const [range, setRange] = useState(defaultDateRange);
  const overviewQuery = useQuery({
    queryKey: ['admin-overview', range.from, range.to],
    queryFn: async () =>
      unwrap(
        await api.get<DashboardOverview>(
          `/admin/reports/overview?from=${range.from}&to=${range.to}`,
        ),
      ),
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
    return (
      <ErrorState
        message={getErrorMessage(overviewQuery.error)}
        onRetry={() => overviewQuery.refetch()}
      />
    );
  }
  const data = overviewQuery.data!;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <h1 className="font-display text-2xl font-semibold">Tổng quan kinh doanh</h1>
          <p className="text-sm text-muted-foreground">
            Số liệu đơn đã thanh toán, theo múi giờ Việt Nam.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-medium">
            Từ ngày
            <Input
              type="date"
              required
              value={range.from}
              max={range.to}
              onChange={(event) => {
                if (event.target.value)
                  setRange((current) => ({ ...current, from: event.target.value }));
              }}
              className="mt-1 w-40"
            />
          </label>
          <label className="text-xs font-medium">
            Đến ngày
            <Input
              type="date"
              required
              value={range.to}
              min={range.from}
              onChange={(event) => {
                if (event.target.value)
                  setRange((current) => ({ ...current, to: event.target.value }));
              }}
              className="mt-1 w-40"
            />
          </label>
          <Button variant="outline" onClick={() => exportOverviewCsv(data, range)}>
            <Download className="h-4 w-4" /> CSV
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> In / PDF
          </Button>
        </div>
      </div>

      <h2 className="font-display text-lg font-semibold">
        Từ {formatDisplayDate(range.from)} đến {formatDisplayDate(range.to)}
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard title="Doanh thu" value={vnd(data.totalRevenue)} tone="success" />
        <KpiCard title="Số đơn" value={data.orderCount.toString()} tone="info" />
        <KpiCard title="Giá trị TB/đơn" value={vnd(data.averageOrderValue)} tone="success" />
        <KpiCard
          title="Sản phẩm bán chạy"
          value={data.topProducts[0]?.name ?? '—'}
          tone="warning"
        />
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

function defaultDateRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 29);
  return { from: formatInputDate(from), to: formatInputDate(to) };
}

function formatInputDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDisplayDate(value: string): string {
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

function exportOverviewCsv(data: DashboardOverview, range: { from: string; to: string }): void {
  const rows: Array<Array<string | number>> = [
    ['Báo cáo Mây Café', `${range.from} - ${range.to}`],
    ['Doanh thu', data.totalRevenue],
    ['Số đơn', data.orderCount],
    ['Giá trị trung bình/đơn', data.averageOrderValue],
    [],
    ['Doanh thu theo ngày'],
    ['Ngày', 'Doanh thu', 'Số đơn'],
    ...data.revenueByDay.map((item) => [item.date, item.revenue, item.orders]),
    [],
    ['Top sản phẩm'],
    ['Sản phẩm', 'Số lượng', 'Doanh thu'],
    ...data.topProducts.map((item) => [item.name, item.quantity, item.revenue]),
  ];
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `may-cafe-${range.from}-${range.to}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function csvCell(value: string | number): string {
  const raw = String(value);
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

function KpiCard({
  title,
  value,
  tone,
}: {
  title: string;
  value: string;
  tone: 'info' | 'success' | 'warning';
}): JSX.Element {
  return (
    <Card className="p-4 space-y-1">
      <Badge tone={tone}>{title}</Badge>
      <p className="font-display text-2xl font-semibold">{value}</p>
    </Card>
  );
}
