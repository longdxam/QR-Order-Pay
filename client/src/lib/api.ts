import axios, { type AxiosError, type AxiosInstance } from 'axios';

const baseURL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api/v1';

export const api: AxiosInstance = axios.create({
  baseURL,
  withCredentials: true,
  timeout: 20000,
});

export interface ApiErrorPayload {
  success: false;
  error: { code: string; message: string; details?: unknown };
  requestId?: string;
}

export function getErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as ApiErrorPayload | undefined;
    if (data?.error?.message) return data.error.message;
    if (err.response?.status === 429)
      return `Bạn thao tác quá nhanh. Vui lòng thử lại sau ${getRetryAfterSeconds(err)} giây.`;
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Đã xảy ra lỗi, vui lòng thử lại.';
}

export function getRetryAfterSeconds(err: unknown): number {
  if (!axios.isAxiosError(err)) return 60;
  const value = err.response?.headers?.['retry-after'];
  if (typeof value !== 'string' && typeof value !== 'number') return 60;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1, Math.ceil(seconds));
  const resetAt = Date.parse(String(value));
  return Number.isFinite(resetAt) ? Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)) : 60;
}

export function getErrorCode(err: unknown): string | undefined {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as ApiErrorPayload | undefined;
    return data?.error?.code;
  }
  return undefined;
}

export function unwrap<T>(res: { data: { data?: T } | T }): T {
  const wrapper = res as { data?: unknown };
  const inner = wrapper.data;
  if (inner && typeof inner === 'object' && 'data' in (inner as Record<string, unknown>)) {
    return (inner as { data: T }).data;
  }
  return inner as T;
}

export function unwrapAny<T>(res: unknown): T {
  return unwrap<T>(res as { data: { data?: T } | T });
}

export function generateIdempotencyKey(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function generateRequestId(): string {
  const h = generateIdempotencyKey();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20)}`;
}

export function vnd(n: number): string {
  return new Intl.NumberFormat('vi-VN').format(n) + '₫';
}

export function getAxiosError(err: unknown): AxiosError | null {
  return axios.isAxiosError(err) ? err : null;
}
