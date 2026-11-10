import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Database,
  Radio,
  RefreshCw,
  Table2,
  Timer,
} from 'lucide-react';
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
    orderStageDurations: Record<
      'acceptance' | 'preparation' | 'service',
      { count: number; averageSeconds: number | null }
    >;
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
    queues: {
      realtime: QueueRuntime;
      reports: QueueRuntime;
      deadLetters: number;
      workers: Array<{
        id: string;
        role: string;
        updatedAt: string;
        lastProgressAt?: string;
        activeJobId?: string | null;
        activeJobStartedAt?: string | null;
      }>;
      redisMemory: { usedBytes: number; maxBytes: number; policy: string; keyCount: number };
    };
    outbox: { pending: number; processing: number; published: number; failed: number };
  };
}
interface QueueRuntime {
  pending: number;
  processing: number;
  oldestPendingAgeSeconds: number;
  expiredProcessing: number;
  retryingSampleCount: number;
}
interface Failures {
  outbox: Array<{
    eventId: string;
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    attempts: number;
    lastError: string;
  }>;
  deadLetters: Array<{ job: { id: string; type: string }; error: string; failedAt: string }>;
}

export function AdminOperations(): JSX.Element {
  useDocumentTitle('Vận hành hệ thống');
  const summaryQuery = useQuery({
    queryKey: ['admin-operations'],
    queryFn: async () => unwrap<OperationsSummary>(await api.get('/admin/operations/summary')),
    refetchInterval: 30_000,
  });
  const qc = useQueryClient();
  const failures = useQuery({
    queryKey: ['admin-operation-failures'],
    queryFn: async () => unwrap<Failures>(await api.get('/admin/operations/failures')),
    refetchInterval: 30_000,
  });
  const replay = useMutation({
    mutationFn: ({ kind, id }: { kind: 'outbox' | 'jobs'; id: string }) =>
      api.post(`/admin/operations/${kind}/${id}/replay`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-operation-failures'] });
      void qc.invalidateQueries({ queryKey: ['admin-operations'] });
    },
  });

  if (summaryQuery.isLoading) {
    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    );
  }
  if (summaryQuery.isError) {
    return (
      <ErrorState
        message={getErrorMessage(summaryQuery.error)}
        onRetry={() => summaryQuery.refetch()}
      />
    );
  }

  const data = summaryQuery.data!;
  const workers = data.database.queues.workers;
  const activeWorkerRoles = new Set(
    workers
      .filter((worker) => Date.now() - Date.parse(worker.updatedAt) <= 30_000)
      .map((worker) => worker.role),
  );
  const missingWorkers =
    !activeWorkerRoles.has('all') &&
    ['scheduler', 'realtime', 'report'].some((role) => !activeWorkerRoles.has(role));
  const failedCount = data.database.outbox.failed + data.database.queues.deadLetters;
  const expiredJobs =
    data.database.queues.realtime.expiredProcessing +
    data.database.queues.reports.expiredProcessing;
  const needsAttention =
    !data.database.mongodbReady ||
    !data.database.redisReady ||
    missingWorkers ||
    failedCount > 0 ||
    expiredJobs > 0 ||
    failures.isError;
  const issues = [
    ...(!data.database.mongodbReady ? ['Mất kết nối dữ liệu'] : []),
    ...(!data.database.redisReady ? ['Kết nối cập nhật đang gián đoạn'] : []),
    ...(missingWorkers ? ['Cần kiểm tra dịch vụ xử lý nền'] : []),
    ...(failedCount > 0 ? [`${failedCount} tác vụ lỗi`] : []),
    ...(expiredJobs > 0 ? [`${expiredJobs} tác vụ quá hạn`] : []),
    ...(failures.isError ? ['Chưa tải được danh sách tác vụ lỗi'] : []),
  ];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold">Vận hành</h1>
        <div className="flex items-center gap-3">
          <time dateTime={data.observedAt} className="text-xs text-muted-foreground">
            {new Date(data.observedAt).toLocaleTimeString('vi-VN', {
              timeZone: 'Asia/Ho_Chi_Minh',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </time>
          <button
            type="button"
            className="btn-ghost text-xs"
            disabled={summaryQuery.isFetching || failures.isFetching}
            onClick={() => {
              void summaryQuery.refetch();
              void failures.refetch();
              void qc.invalidateQueries({ queryKey: ['admin-anomalies'] });
            }}
          >
            <RefreshCw className="h-4 w-4" /> Làm mới
          </button>
        </div>
      </header>

      <Card className="flex flex-wrap items-center gap-3 p-4">
        {needsAttention ? (
          <AlertTriangle className="h-6 w-6 text-warning" />
        ) : (
          <CheckCircle2 className="h-6 w-6 text-success" />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">
            {needsAttention ? 'Hệ thống cần kiểm tra' : 'Kết nối hệ thống ổn định'}
          </h2>
          {issues.length ? (
            <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
        </div>
        <Badge tone={needsAttention ? 'warning' : 'success'}>
          {needsAttention ? 'Cần chú ý' : 'Đã kết nối'}
        </Badge>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          icon={<Table2 className="h-4 w-4" />}
          title="Bàn đang phục vụ"
          value={String(data.database.activeSessions)}
          tone="info"
        />
        <MetricCard
          icon={<Activity className="h-4 w-4" />}
          title="Đơn đang xử lý"
          value={String(data.database.activeOrders)}
          tone="info"
        />
        <MetricCard
          icon={<BellRing className="h-4 w-4" />}
          title="Yêu cầu phục vụ"
          value={String(data.database.openServiceRequests)}
          tone={data.database.openServiceRequests > 0 ? 'warning' : 'info'}
        />
        <MetricCard
          icon={<Timer className="h-4 w-4" />}
          title="Đơn chờ lâu nhất"
          value={formatDuration(data.database.oldestQueueAgeSeconds)}
          tone={data.database.oldestQueueAgeSeconds > 900 ? 'warning' : 'info'}
        />
      </div>

      <Card className="p-4">
        <h2 className="font-semibold">Tiến độ đơn hàng</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          {(['PENDING', 'CONFIRMED', 'PREPARING', 'READY'] as const).map((status) => (
            <div key={status} className="rounded-xl bg-muted/60 p-3">
              <p className="text-xs text-muted-foreground">{orderStatusLabel(status)}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {data.database.ordersByStatus[status]}
              </p>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="font-semibold">Tác vụ cần xử lý</h2>
        <div className="mt-3 space-y-3">
          {failures.isLoading ? (
            <p role="status" className="text-sm text-muted-foreground">
              Đang kiểm tra tác vụ…
            </p>
          ) : failures.isError ? (
            <ErrorState
              message={getErrorMessage(failures.error)}
              onRetry={() => failures.refetch()}
            />
          ) : failures.data ? (
            <>
              {failures.data.outbox.map((item) => (
                <div
                  key={item.eventId}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-warning/10 p-3 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">Thông báo chưa gửi được</p>
                    <details className="mt-1 text-xs text-muted-foreground">
                      <summary className="cursor-pointer">Xem lỗi</summary>
                      <p className="mt-2 break-words">
                        {item.eventType} · {item.aggregateType}/{item.aggregateId} ·{' '}
                        {item.lastError}
                      </p>
                    </details>
                  </div>
                  <button
                    type="button"
                    className="btn-ghost shrink-0 text-xs"
                    disabled={replay.isPending}
                    onClick={() => replay.mutate({ kind: 'outbox', id: item.eventId })}
                  >
                    Gửi lại thông báo
                  </button>
                </div>
              ))}
              {failures.data.deadLetters.map((item) => (
                <div
                  key={item.job.id}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-warning/10 p-3 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">Tác vụ chưa hoàn tất</p>
                    <details className="mt-1 text-xs text-muted-foreground">
                      <summary className="cursor-pointer">Xem lỗi</summary>
                      <p className="mt-2 break-words">
                        {item.job.type} · {item.job.id} · {item.error}
                      </p>
                    </details>
                  </div>
                  <button
                    type="button"
                    className="btn-ghost shrink-0 text-xs"
                    disabled={replay.isPending}
                    onClick={() => replay.mutate({ kind: 'jobs', id: item.job.id })}
                  >
                    Chạy lại tác vụ
                  </button>
                </div>
              ))}
              {!failures.data.outbox.length && !failures.data.deadLetters.length ? (
                <p className="text-sm text-muted-foreground">Không có tác vụ lỗi cần thử lại.</p>
              ) : null}
            </>
          ) : null}
          {replay.isError ? (
            <p role="alert" className="text-sm text-danger">
              {getErrorMessage(replay.error)}
            </p>
          ) : null}
          {replay.isSuccess ? (
            <p role="status" className="text-sm text-success">
              Đã gửi yêu cầu thử lại.
            </p>
          ) : null}
        </div>
      </Card>

      <AnomalyPanel />

      <details className="rounded-2xl border border-border bg-card p-4">
        <summary className="cursor-pointer font-semibold">Chi tiết kỹ thuật</summary>
        <div className="mt-4">
          <TechnicalDetails data={data} />
        </div>
      </details>
    </div>
  );
}

function TechnicalDetails({ data }: { data: OperationsSummary }): JSX.Element {
  const errorRate =
    data.instance.http.requests > 0
      ? (data.instance.http.serverErrors / data.instance.http.requests) * 100
      : 0;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          icon={<Database className="h-4 w-4" />}
          title="MongoDB"
          value={data.database.mongodbReady ? 'Sẵn sàng' : 'Gián đoạn'}
          tone={data.database.mongodbReady ? 'success' : 'danger'}
        />
        <MetricCard
          icon={<Database className="h-4 w-4" />}
          title="Redis"
          value={data.database.redisReady ? 'Sẵn sàng' : 'Gián đoạn'}
          tone={data.database.redisReady ? 'success' : 'warning'}
        />
        <MetricCard
          icon={<Radio className="h-4 w-4" />}
          title="Kết nối realtime tại máy chủ này"
          value={String(data.instance.sockets.guest + data.instance.sockets.staff)}
          tone="info"
        />
      </div>
      <Card className="p-4">
        <h2 className="font-semibold">Máy chủ {data.instance.instanceId}</h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Stat label="Thời gian hoạt động" value={formatDuration(data.instance.uptimeSeconds)} />
          <Stat label="Lượt truy cập" value={data.instance.http.requests.toLocaleString('vi-VN')} />
          <Stat
            label="Lỗi 4xx / giới hạn 429"
            value={`${data.instance.http.clientErrors} / ${data.instance.http.rateLimited}`}
          />
          <Stat
            label="Lỗi 5xx"
            value={`${data.instance.http.serverErrors} (${errorRate.toFixed(2)}%)`}
          />
          <Stat label="Bộ nhớ RSS" value={formatBytes(data.instance.process.rssBytes)} />
          <Stat label="Bộ nhớ heap" value={formatBytes(data.instance.process.heapUsedBytes)} />
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          Lượt truy cập, kết nối và sự kiện thuộc riêng máy chủ này; số bàn và đơn lấy từ dữ liệu
          chung.
        </p>
      </Card>
      <div className="grid gap-3 lg:grid-cols-2">
        {(
          [
            ['Cập nhật realtime', data.database.queues.realtime],
            ['Báo cáo', data.database.queues.reports],
          ] as const
        ).map(([name, queue]) => (
          <Card key={name} className="p-4">
            <h2 className="font-semibold">{name}</h2>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <Stat label="Chờ xử lý" value={String(queue.pending)} />
              <Stat label="Đang xử lý" value={String(queue.processing)} />
              <Stat label="Chờ lâu nhất" value={formatDuration(queue.oldestPendingAgeSeconds)} />
              <Stat label="Quá hạn xử lý" value={String(queue.expiredProcessing)} />
              <Stat label="Đang thử lại (mẫu 1.000)" value={String(queue.retryingSampleCount)} />
            </dl>
          </Card>
        ))}
      </div>
      <Card className="p-4">
        <h2 className="font-semibold">Dịch vụ xử lý nền</h2>
        <div className="mt-3 space-y-2">
          {data.database.queues.workers.map((worker) => {
            const stale = Date.now() - Date.parse(worker.updatedAt) > 30_000;
            return (
              <div key={worker.id} className="flex flex-wrap items-center gap-2 text-xs">
                <Badge tone={stale ? 'warning' : 'success'}>
                  {worker.role} · {stale ? 'Mất tín hiệu' : 'Đang hoạt động'}
                </Badge>
                <span className="break-all text-muted-foreground">
                  {worker.id} ·{' '}
                  {new Date(worker.updatedAt).toLocaleTimeString('vi-VN', {
                    timeZone: 'Asia/Ho_Chi_Minh',
                  })}
                </span>
                {worker.activeJobStartedAt ? (
                  <span>
                    {worker.activeJobId} ·{' '}
                    {formatDuration(
                      Math.floor((Date.now() - Date.parse(worker.activeJobStartedAt)) / 1000),
                    )}
                  </span>
                ) : null}
              </div>
            );
          })}
          {!data.database.queues.workers.length ? (
            <p className="text-sm text-warning">Chưa nhận được tín hiệu từ dịch vụ xử lý nền.</p>
          ) : null}
        </div>
      </Card>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="font-semibold">Thông báo hệ thống (outbox)</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label="Chờ gửi" value={String(data.database.outbox.pending)} />
            <Stat label="Đang gửi" value={String(data.database.outbox.processing)} />
            <Stat label="Đã gửi" value={String(data.database.outbox.published)} />
            <Stat label="Gửi lỗi" value={String(data.database.outbox.failed)} />
            <Stat label="Tác vụ lỗi" value={String(data.database.queues.deadLetters)} />
          </dl>
        </Card>
        <Card className="p-4">
          <h2 className="font-semibold">Bộ nhớ Redis</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <Stat
              label="Đang dùng"
              value={formatBytes(data.database.queues.redisMemory.usedBytes)}
            />
            <Stat
              label="Giới hạn"
              value={
                data.database.queues.redisMemory.maxBytes > 0
                  ? formatBytes(data.database.queues.redisMemory.maxBytes)
                  : 'Không đặt giới hạn'
              }
            />
            <Stat label="Số khóa" value={String(data.database.queues.redisMemory.keyCount)} />
            <Stat label="Chính sách" value={data.database.queues.redisMemory.policy} />
          </dl>
        </Card>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="font-semibold">Sự kiện từ khi máy chủ khởi động</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <Stat label="Đơn mới" value={String(data.instance.businessEvents.order_created ?? 0)} />
            <Stat
              label="Đơn hủy"
              value={String(data.instance.businessEvents.order_cancelled ?? 0)}
            />
            <Stat
              label="Thanh toán mới"
              value={String(data.instance.businessEvents.payment_confirmed ?? 0)}
            />
            <Stat
              label="Phiên mới"
              value={String(data.instance.businessEvents.table_session_created ?? 0)}
            />
          </dl>
        </Card>
        <Card className="p-4">
          <h2 className="font-semibold">Thời gian xử lý tại máy chủ này</h2>
          <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
            <StageStat label="Nhận đơn" value={data.instance.orderStageDurations.acceptance} />
            <StageStat label="Pha chế" value={data.instance.orderStageDurations.preparation} />
            <StageStat label="Phục vụ" value={data.instance.orderStageDurations.service} />
          </dl>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({
  icon,
  title,
  value,
  tone,
}: {
  icon: JSX.Element;
  title: string;
  value: string;
  tone: 'info' | 'success' | 'warning' | 'danger';
}): JSX.Element {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs">{title}</span>
      </div>
      <div className="mt-2">
        <Badge tone={tone} className="text-xl tabular-nums">
          {value}
        </Badge>
      </div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-all font-medium">{value}</dd>
    </div>
  );
}

function StageStat({
  label,
  value,
}: {
  label: string;
  value: { count: number; averageSeconds: number | null };
}): JSX.Element {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">
        {value.averageSeconds === null
          ? 'Chưa đủ dữ liệu'
          : `${formatDuration(Math.round(value.averageSeconds))} TB`}
      </dd>
      <p className="text-xs text-muted-foreground">{value.count} mẫu</p>
    </div>
  );
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
  return (
    (
      {
        PENDING: 'Chờ xác nhận',
        CONFIRMED: 'Đã xác nhận',
        PREPARING: 'Đang pha chế',
        READY: 'Sẵn sàng',
      } as Record<string, string>
    )[status] ?? status
  );
}
