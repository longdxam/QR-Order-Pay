import { useQuery } from '@tanstack/react-query';
import { Activity, Database, Radio, RefreshCw, Server, Timer } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { ErrorState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';
import { api, getErrorMessage, unwrap } from '../../lib/api';
import { AnomalyPanel } from './AnomalyPanel';

interface OperationsSummary {
  observedAt: string;
  instance: {
    scope: 'instance';
    instanceId: string;
    startedAt: string;
    uptimeSeconds: number;
    http: { requests: number; clientErrors: number; rateLimited: number; serverErrors: number };
    businessEvents: Record<string, number>;
    orderStageDurations: Record<'acceptance' | 'preparation' | 'service', { count: number; averageSeconds: number | null }>;
    sockets: { guest: number; staff: number };
    dependencies: { mongodb: boolean; redis: boolean };
    process: { rssBytes: number; heapUsedBytes: number };
  };
  database: {
    scope: 'database';
    mongodbReady: boolean;
    redisReady: boolean;
    activeSessions: number;
    openServiceRequests: number;
    activeOrders: number;
    ordersByStatus: Record<'PENDING' | 'CONFIRMED' | 'PREPARING' | 'READY', number>;
    oldestQueuedAt: string | null;
    oldestQueueAgeSeconds: number;
  };
}

export function AdminOperations(): JSX.Element {
  useDocumentTitle('Vận hành hệ thống');
  const summaryQuery = useQuery({
    queryKey: ['admin-operations'],
    queryFn: async () => unwrap<OperationsSummary>(await api.get('/admin/operations/summary')),
    refetchInterval: 30_000,
  });

  if (summaryQuery.isLoading) {
    return <div className="grid grid-cols-1 gap-3 md:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div>;
  }
  if (summaryQuery.isError) {
    return <ErrorState message={getErrorMessage(summaryQuery.error)} onRetry={() => summaryQuery.refetch()} />;
  }

  const data = summaryQuery.data!;
  const errorRate = data.instance.http.requests > 0
    ? (data.instance.http.serverErrors / data.instance.http.requests) * 100
    : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl font-semibold">Vận hành hệ thống</h1>
          <p className="text-sm text-muted-foreground">Số liệu tiến trình hiện tại và trạng thái hàng đợi trong cơ sở dữ liệu.</p>
        </div>
        <button className="btn-ghost text-xs" onClick={() => summaryQuery.refetch()} disabled={summaryQuery.isFetching}>
          <RefreshCw className={`h-4 w-4 ${summaryQuery.isFetching ? 'animate-spin' : ''}`} /> Làm mới
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard icon={<Database className="h-4 w-4" />} title="MongoDB" value={data.database.mongodbReady ? 'Sẵn sàng' : 'Gián đoạn'} tone={data.database.mongodbReady ? 'success' : 'danger'} />
        <MetricCard icon={<Database className="h-4 w-4" />} title="Redis" value={data.database.redisReady ? 'Sẵn sàng' : 'Suy giảm'} tone={data.database.redisReady ? 'success' : 'warning'} />
        <MetricCard icon={<Activity className="h-4 w-4" />} title="Đơn đang xử lý" value={String(data.database.activeOrders)} tone="info" />
        <MetricCard icon={<Timer className="h-4 w-4" />} title="Đơn chờ lâu nhất" value={formatDuration(data.database.oldestQueueAgeSeconds)} tone={data.database.oldestQueueAgeSeconds > 900 ? 'warning' : 'info'} />
        <MetricCard icon={<Radio className="h-4 w-4" />} title="Socket đang kết nối" value={String(data.instance.sockets.guest + data.instance.sockets.staff)} tone="info" />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="font-display font-semibold">Hàng đợi hiện tại</h2>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {Object.entries(data.database.ordersByStatus).map(([status, count]) => (
              <div key={status} className="rounded-xl bg-muted p-3">
                <p className="text-xs text-muted-foreground">{orderStatusLabel(status)}</p>
                <p className="mt-1 text-2xl font-semibold">{count}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            <Badge tone="info">{data.database.activeSessions} phiên bàn mở</Badge>
            <Badge tone={data.database.openServiceRequests > 0 ? 'warning' : 'success'}>{data.database.openServiceRequests} yêu cầu phục vụ</Badge>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4" />
            <h2 className="font-display font-semibold">Tiến trình ứng dụng</h2>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <Stat label="Instance" value={data.instance.instanceId} />
            <Stat label="Uptime" value={formatDuration(data.instance.uptimeSeconds)} />
            <Stat label="HTTP requests" value={data.instance.http.requests.toLocaleString('vi-VN')} />
            <Stat label="Lỗi 4xx" value={`${data.instance.http.clientErrors} (429: ${data.instance.http.rateLimited})`} />
            <Stat label="Lỗi 5xx" value={`${data.instance.http.serverErrors} (${errorRate.toFixed(2)}%)`} />
            <Stat label="RSS" value={formatBytes(data.instance.process.rssBytes)} />
            <Stat label="Heap dùng" value={formatBytes(data.instance.process.heapUsedBytes)} />
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">Số HTTP, lỗi, socket và sự kiện chỉ thuộc instance này; số phiên và đơn lấy trực tiếp từ database.</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="font-display font-semibold">Sự kiện từ khi instance khởi động</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label="Đơn mới" value={String(data.instance.businessEvents.order_created ?? 0)} />
            <Stat label="Đơn hủy" value={String(data.instance.businessEvents.order_cancelled ?? 0)} />
            <Stat label="Thanh toán mới" value={String(data.instance.businessEvents.payment_confirmed ?? 0)} />
            <Stat label="Phiên mới" value={String(data.instance.businessEvents.table_session_created ?? 0)} />
          </dl>
        </Card>
        <Card className="p-4">
          <h2 className="font-display font-semibold">Thời gian hoàn thành công đoạn</h2>
          <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
            <StageStat label="Nhận đơn" value={data.instance.orderStageDurations.acceptance} />
            <StageStat label="Pha chế" value={data.instance.orderStageDurations.preparation} />
            <StageStat label="Phục vụ" value={data.instance.orderStageDurations.service} />
          </dl>
        </Card>
      </div>

      <AnomalyPanel />

      <p className="text-xs text-muted-foreground">Cập nhật lúc {new Date(data.observedAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} (Asia/Ho_Chi_Minh) · tự làm mới mỗi 30 giây.</p>
    </div>
  );
}

function MetricCard({ icon, title, value, tone }: { icon: JSX.Element; title: string; value: string; tone: 'info' | 'success' | 'warning' | 'danger' }): JSX.Element {
  return <Card className="p-4"><div className="flex items-center gap-2 text-muted-foreground">{icon}<span className="text-xs">{title}</span></div><div className="mt-2"><Badge tone={tone}>{value}</Badge></div></Card>;
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 break-all font-medium">{value}</dd></div>;
}

function StageStat({ label, value }: { label: string; value: { count: number; averageSeconds: number | null } }): JSX.Element {
  return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 font-medium">{value.averageSeconds === null ? 'Chưa đủ dữ liệu' : `${formatDuration(Math.round(value.averageSeconds))} TB`}</dd><p className="text-xs text-muted-foreground">{value.count} mẫu</p></div>;
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}g ${minutes}p`;
  if (minutes > 0) return `${minutes}p`;
  return `${Math.max(0, totalSeconds)}s`;
}

function orderStatusLabel(status: string): string {
  return ({ PENDING: 'Chờ xác nhận', CONFIRMED: 'Đã xác nhận', PREPARING: 'Đang pha chế', READY: 'Sẵn sàng' } as Record<string, string>)[status] ?? status;
}
