import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AnomalyAlert,
  AnomalyDashboardResponse,
  AnomalyEvaluation,
} from '@may-cafe/contracts';
import { AlertTriangle, CheckCircle2, CircleHelp, ShieldAlert } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ErrorState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { api, getErrorMessage, unwrap } from '../../lib/api';

export function AnomalyPanel(): JSX.Element {
  const queryClient = useQueryClient();
  const dashboard = useQuery({
    queryKey: ['admin-anomalies'],
    queryFn: async () => unwrap<AnomalyDashboardResponse>(await api.get('/admin/anomalies')),
    refetchInterval: 30_000,
  });
  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'ACKNOWLEDGED' | 'CLOSED' }) =>
      unwrap(await api.patch(`/admin/anomalies/${id}/status`, { status })),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['admin-anomalies'] }),
  });

  if (dashboard.isLoading) return <Skeleton className="h-48" />;
  if (dashboard.isError)
    return (
      <ErrorState message={getErrorMessage(dashboard.error)} onRetry={() => dashboard.refetch()} />
    );
  const data = dashboard.data!;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-display text-lg font-semibold">Cảnh báo bất thường</h2>
      </div>

      <details className="rounded-xl border border-border p-3">
        <summary className="cursor-pointer text-sm font-medium">Các chỉ số theo dõi</summary>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {data.evaluations.map((evaluation) => (
            <DetectorCard key={evaluation.detector} evaluation={evaluation} />
          ))}
        </div>
      </details>

      {data.alerts.length === 0 ? (
        <Card className="p-4 text-sm text-muted-foreground">
          Chưa có cảnh báo.
          {!data.evaluations.length ||
          data.evaluations.some((item) => item.state !== 'OK' && item.state !== 'ALERT')
            ? ' Một số chỉ số chưa đủ dữ liệu.'
            : ''}
        </Card>
      ) : (
        <div className="space-y-3">
          {data.alerts.map((alert) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              busy={updateStatus.isPending}
              onStatus={(status) => updateStatus.mutate({ id: alert.id, status })}
            />
          ))}
        </div>
      )}

      {updateStatus.isError ? (
        <p role="alert" className="text-sm text-danger">
          {getErrorMessage(updateStatus.error)}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Lần kiểm tra gần nhất: {data.lastRunAt ? formatDate(data.lastRunAt) : 'Chưa chạy'}
      </p>
    </section>
  );
}

function DetectorCard({ evaluation }: { evaluation: AnomalyEvaluation }): JSX.Element {
  const state =
    evaluation.state === 'ALERT'
      ? { icon: <ShieldAlert className="h-4 w-4" />, label: 'Cảnh báo', tone: 'danger' as const }
      : evaluation.state === 'OK'
        ? {
            icon: <CheckCircle2 className="h-4 w-4" />,
            label: 'Trong ngưỡng',
            tone: 'success' as const,
          }
        : {
            icon: <CircleHelp className="h-4 w-4" />,
            label: 'Chưa đủ dữ liệu',
            tone: 'neutral' as const,
          };
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {state.icon}
        <span>{detectorLabel(evaluation.detector)}</span>
      </div>
      <div className="mt-2">
        <Badge tone={state.tone}>{state.label}</Badge>
      </div>
      <p className="mt-2 text-xs">
        {formatValue(evaluation)} · {evaluation.sampleCount}/{evaluation.baselineSampleCount} mẫu
      </p>
    </Card>
  );
}

function AlertCard({
  alert,
  busy,
  onStatus,
}: {
  alert: AnomalyAlert;
  busy: boolean;
  onStatus: (status: 'ACKNOWLEDGED' | 'CLOSED') => void;
}): JSX.Element {
  return (
    <Card className="border border-danger/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-danger" />
            <h3 className="font-semibold">{detectorLabel(alert.detector)}</h3>
            <Badge tone={alert.severity === 'CRITICAL' ? 'danger' : 'warning'}>
              {alert.severity}
            </Badge>
            <Badge tone={alert.status === 'CLOSED' ? 'success' : 'info'}>
              {statusLabel(alert.status)}
            </Badge>
            <Badge>{alert.explanation.mode === 'llm' ? 'AI live' : 'Giải thích mẫu'}</Badge>
          </div>
          <p className="mt-2 text-sm">{alert.explanation.summary}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatDate(alert.windowStart)} — {formatDate(alert.windowEnd)} · {alert.sampleCount}{' '}
            mẫu
          </p>
        </div>
        {alert.status !== 'CLOSED' ? (
          <div className="flex gap-2">
            {alert.status === 'OPEN' ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => onStatus('ACKNOWLEDGED')}
              >
                Đã xem
              </Button>
            ) : null}
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onStatus('CLOSED')}>
              Đóng cảnh báo
            </Button>
          </div>
        ) : null}
      </div>
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer font-medium">Chi tiết cảnh báo</summary>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <EvidenceList title="Bằng chứng" values={alert.explanation.evidence} />
          <EvidenceList title="Giả thuyết cần kiểm tra" values={alert.explanation.hypotheses} />
          <EvidenceList title="Bước kiểm tra" values={alert.explanation.checks} />
        </div>
      </details>
    </Card>
  );
}

function EvidenceList({ title, values }: { title: string; values: string[] }): JSX.Element {
  return (
    <div>
      <p className="font-medium">{title}</p>
      <ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">
        {values.map((value) => (
          <li key={value}>{value}</li>
        ))}
      </ul>
    </div>
  );
}

function detectorLabel(detector: AnomalyEvaluation['detector']): string {
  return (
    {
      HTTP_ERROR_RATE: 'Tỷ lệ lỗi HTTP 5xx',
      HTTP_LATENCY_P95: 'Độ trễ HTTP p95',
      PREPARATION_P95: 'Pha chế p95',
      CANCELLATION_RATE: 'Tỷ lệ hủy đơn',
    } as const
  )[detector];
}

function statusLabel(status: AnomalyAlert['status']): string {
  return ({ OPEN: 'Đang mở', ACKNOWLEDGED: 'Đã xem', CLOSED: 'Đã đóng' } as const)[status];
}

function formatValue(evaluation: AnomalyEvaluation): string {
  if (evaluation.observedValue === null) return 'Chưa có giá trị tin cậy';
  if (evaluation.detector.endsWith('RATE'))
    return `${(evaluation.observedValue * 100).toFixed(1)}% / ngưỡng ${(evaluation.thresholdValue * 100).toFixed(1)}%`;
  const unit = evaluation.detector === 'HTTP_LATENCY_P95' ? 'ms' : 'giây';
  return `${Math.round(evaluation.observedValue)} ${unit} / ngưỡng ${Math.round(evaluation.thresholdValue)} ${unit}`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}
