import type { ReactNode } from 'react';
import type { DashboardOverview } from '@may-cafe/contracts';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card } from '../../components/ui/Card';
import { vnd } from '../../lib/api';

const COLORS = { positive: '#287459', negative: '#b83c35', orders: '#346f9d', category: '#b07831' };
const METHODS: Record<string, string> = {
  CASH: 'Tiền mặt',
  BANK_TRANSFER: 'Chuyển khoản',
  OTHER: 'Khác',
};
const dateLabel = (date: string) => date.split('-').reverse().join('/');
const rate = (value: number | null | undefined) =>
  value == null
    ? 'Chưa có đơn'
    : `${(value * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`;

export function BusinessReports({ data }: { data: DashboardOverview }): JSX.Element {
  const hasMoney =
    data.hasFinancialData ?? !!(data.grossCollected || data.totalRefunded || data.adjustmentAmount);
  const previous = data.comparison;
  const methods = (data.revenueByMethod ?? []).map((row) => ({
    ...row,
    name: METHODS[row.method] ?? 'Chưa xác định',
  }));
  return (
    <>
      <Card className="space-y-3 p-5">
        <h3 className="font-display font-semibold">Đơn hàng & so sánh kỳ trước</h3>
        {previous ? (
          <p className="text-xs text-muted-foreground">
            Kỳ trước cùng số ngày: {dateLabel(previous.from)} – {dateLabel(previous.to)}. Tiền theo
            ngày thu/hoàn; đơn và hủy theo ngày tạo đơn, trạng thái hiện tại.
          </p>
        ) : null}
        <dl className="grid gap-4 sm:grid-cols-3">
          <Metric
            label="Thực thu ròng"
            value={vnd(data.totalRevenue)}
            previous={previous ? vnd(previous.totalRevenue) : undefined}
            change={previous ? moneyChange(data.totalRevenue, previous.totalRevenue) : undefined}
          />
          <Metric
            label="Đơn tạo trong kỳ"
            value={String(data.ordersCreated ?? 0)}
            previous={previous ? `${previous.ordersCreated} đơn` : undefined}
            change={
              previous
                ? `${signed((data.ordersCreated ?? 0) - previous.ordersCreated)} đơn`
                : undefined
            }
          />
          <Metric
            label="Tỉ lệ hủy"
            value={rate(data.cancellationRate)}
            previous={previous ? rate(previous.cancellationRate) : undefined}
            change={
              data.ordersCreated
                ? `${data.cancelledOrders ?? 0}/${data.ordersCreated} đơn`
                : 'Không có mẫu để tính'
            }
          />
        </dl>
      </Card>
      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard
          title="Thực thu ròng theo ngày"
          help="Mỗi cột là một ngày theo giờ Việt Nam, kể cả ngày không có giao dịch (0đ). Thực thu = thu − hoàn + điều chỉnh; cột âm khi tiền ra lớn hơn tiền vào."
          empty={!hasMoney}
        >
          <MoneyChart rows={data.revenueByDay} x="date" date />
        </ChartCard>
        <ChartCard
          title="Thực thu ròng theo giờ"
          help="Cộng giao dịch cùng giờ trong toàn khoảng chọn, theo giờ Việt Nam. Cột đỏ dưới 0 là hoàn tiền hoặc điều chỉnh giảm nhiều hơn tiền thu; không phải số đơn âm."
          empty={!hasMoney}
        >
          <MoneyChart rows={data.revenueByHour} x="hour" />
          <p className="text-xs text-muted-foreground">
            Xanh: ròng dương · Đỏ: ròng âm do hoàn/điều chỉnh vượt tiền thu.
          </p>
        </ChartCard>
        <ChartCard
          title="Giờ cao điểm theo số đơn"
          help="Đếm tất cả đơn tạo trong kỳ theo giờ Việt Nam, gồm chờ thanh toán và đã hủy. Dùng để xem nhu cầu, không dùng thay số đơn đã thu tiền."
          empty={!data.ordersCreated}
        >
          <div className="h-64" role="img" aria-label="Số đơn tạo theo 24 giờ">
            <ResponsiveContainer>
              <BarChart data={data.ordersByHour ?? []}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="hour" tickFormatter={(v) => `${v}h`} tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip
                  labelFormatter={(v) => `${v}h – ${Number(v) + 1}h`}
                  formatter={(v: number) => [v, 'Đơn tạo']}
                />
                <Bar dataKey="orders" fill={COLORS.orders} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
        <ChartCard
          title="Tiền món theo danh mục"
          help="Theo ngày tạo của đơn PAID chưa hủy; cộng giá trị món trước ưu đãi/hoàn/điều chỉnh tài chính. Phân loại theo danh mục hiện tại của sản phẩm, vì đơn cũ chưa lưu snapshot danh mục. Không cộng số này vào thực thu."
          empty={!data.categorySales?.length}
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th>Danh mục</th>
                <th>Số món</th>
                <th className="text-right">Tiền món</th>
              </tr>
            </thead>
            <tbody>
              {data.categorySales?.map((row) => (
                <tr key={row.categoryId} className="border-t border-border">
                  <td className="py-3">
                    <span
                      className="mr-2 inline-block h-2 w-2 rounded-full"
                      style={{ background: COLORS.category }}
                    />
                    {row.name}
                  </td>
                  <td>{row.quantity}</td>
                  <td className="text-right tabular-nums">{vnd(row.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ChartCard>
      </div>
      <ChartCard
        title="Thực thu theo phương thức thanh toán"
        help="Theo ngày phát sinh giao dịch. Hoàn tiền dùng phương thức hoàn thực tế; đổi phương thức ghi giảm bên cũ và tăng bên mới. Tổng cột Ròng bằng thực thu ròng trong kỳ."
        empty={!hasMoney}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th>Phương thức</th>
                <th>Thu</th>
                <th>Hoàn</th>
                <th>Điều chỉnh</th>
                <th>Ròng</th>
              </tr>
            </thead>
            <tbody>
              {methods.map((row) => (
                <tr key={row.method} className="border-t border-border">
                  <td className="py-3 font-medium">{row.name}</td>
                  <td>{vnd(row.collected)}</td>
                  <td className="text-danger">{vnd(row.refunded)}</td>
                  <td>{vnd(row.adjustment)}</td>
                  <td
                    className={
                      row.revenue < 0 ? 'font-semibold text-danger' : 'font-semibold text-success'
                    }
                  >
                    {vnd(row.revenue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>
    </>
  );
}

function MoneyChart({
  rows,
  x,
  date = false,
}: {
  rows: Array<{ revenue: number; date?: string; hour?: number }>;
  x: 'date' | 'hour';
  date?: boolean;
}): JSX.Element {
  return (
    <div
      className="h-64"
      role="img"
      aria-label={
        date ? 'Thực thu từng ngày, gồm ngày 0 đồng' : 'Thực thu theo giờ; đỏ là giá trị âm'
      }
    >
      <ResponsiveContainer>
        <BarChart data={rows}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey={x}
            tickFormatter={(v) =>
              date ? String(v).slice(5).split('-').reverse().join('/') : `${v}h`
            }
            tick={{ fontSize: 10 }}
            minTickGap={20}
          />
          <YAxis tickFormatter={(v) => `${v / 1000}k`} tick={{ fontSize: 10 }} />
          <ReferenceLine y={0} stroke="#6b625b" />
          <Tooltip
            labelFormatter={(v) => (date ? dateLabel(String(v)) : `${v}h – ${Number(v) + 1}h`)}
            formatter={(v: number) => [
              vnd(v),
              Number(v) < 0 ? 'Ròng âm: hoàn/điều chỉnh vượt thu' : 'Thực thu ròng',
            ]}
          />
          <Bar dataKey="revenue" isAnimationActive={false}>
            {rows.map((row, index) => (
              <Cell key={index} fill={row.revenue < 0 ? COLORS.negative : COLORS.positive} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
function ChartCard({
  title,
  help,
  empty,
  children,
}: {
  title: string;
  help: string;
  empty: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <Card className="min-w-0 space-y-3 p-5">
      <h3 className="font-display font-semibold">{title}</h3>
      <details className="text-xs text-muted-foreground">
        <summary className="w-fit cursor-pointer" title={help}>
          Cách đọc
        </summary>
        <p className="mt-2 leading-relaxed">{help}</p>
      </details>
      {empty ? (
        <p role="status" className="rounded-xl bg-muted p-6 text-sm text-muted-foreground">
          Chưa có dữ liệu trong khoảng ngày này.
        </p>
      ) : (
        children
      )}
    </Card>
  );
}
function Metric({
  label,
  value,
  previous,
  change,
}: {
  label: string;
  value: string;
  previous?: string;
  change?: string;
}): JSX.Element {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-xl font-semibold">{value}</dd>
      {previous ? (
        <dd className="mt-1 text-xs text-muted-foreground">
          Kỳ trước: {previous}
          {change ? ` · ${change}` : ''}
        </dd>
      ) : null}
    </div>
  );
}
function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toLocaleString('vi-VN')}`;
}
function moneyChange(current: number, previous: number): string {
  const delta = current - previous;
  const absolute = `${delta > 0 ? '+' : ''}${vnd(delta)}`;
  return previous > 0
    ? `${absolute} (${signed(Math.round((delta / previous) * 1000) / 10)}%)`
    : `${absolute}; kỳ trước ${previous === 0 ? '0đ' : 'âm'}, không tính %`;
}
