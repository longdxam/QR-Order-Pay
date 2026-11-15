import { Database, Radio } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { Card } from '../../../components/ui/Card';
import type { OperationsSummary } from './types';
import { formatBytes, formatDuration } from './format';

/** Khá»‘i "Chi tiáº¿t ká»¹ thuáº­t" Ä‘Ã³ng máº·c Ä‘á»‹nh: mÃ¡y chá»§, hÃ ng Ä‘á»£i, worker, outbox, Redis, sá»± kiá»‡n. */
export function TechnicalDetails({ data }: { data: OperationsSummary }): JSX.Element {
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

export function MetricCard({
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
