import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  BellRing,
  CheckCircle2,
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
import type { Failures, OperationsSummary } from './operations/types';
import { formatDuration, orderStatusLabel } from './operations/format';
import { MetricCard, TechnicalDetails } from './operations/TechnicalDetails';
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
