import type { DashboardOverview } from '@may-cafe/contracts';
import { api, unwrap } from './api';

interface ReportJobState<T> {
  id: string;
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  result?: T;
  error?: string;
}

export async function createOverviewReport(
  range: { from?: string; to?: string },
  format: 'json',
  signal?: AbortSignal,
): Promise<DashboardOverview>;
export async function createOverviewReport(
  range: { from?: string; to?: string },
  format: 'csv',
  signal?: AbortSignal,
): Promise<string>;
export async function createOverviewReport(
  range: { from?: string; to?: string },
  format: 'json' | 'csv',
  signal?: AbortSignal,
): Promise<DashboardOverview | string> {
  const queued = unwrap<ReportJobState<never>>(
    await api.post('/admin/reports/overview/jobs', { ...range, format }, { signal }),
  );

  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const state = unwrap<ReportJobState<DashboardOverview | string>>(
      await api.get(`/admin/reports/jobs/${queued.id}`, { signal }),
    );
    if (state.status === 'COMPLETED' && state.result !== undefined) return state.result;
    if (state.status === 'FAILED') throw new Error(state.error ?? 'Không thể tạo báo cáo.');
    await delay(250, signal);
  }
  throw new Error('Worker tạo báo cáo quá thời gian chờ.');
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
