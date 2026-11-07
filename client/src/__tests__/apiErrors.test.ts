import { describe, expect, it } from 'vitest';
import { getErrorMessage, getRetryAfterSeconds } from '../lib/api';

const limited = (value?: string, data?: unknown) => ({
  isAxiosError: true,
  message: 'Request failed with status code 429',
  response: { status: 429, headers: { 'retry-after': value }, data },
});
describe('rate-limit feedback', () => {
  it('handles plain text or HTML 429 responses without exposing raw Axios messages', () => {
    expect(getErrorMessage(limited('12', '<html>Too Many Requests</html>'))).toBe(
      'Bạn thao tác quá nhanh. Vui lòng thử lại sau 12 giây.',
    );
    expect(getErrorMessage(limited(undefined))).toContain('60 giây');
    expect(getRetryAfterSeconds(limited('0'))).toBe(1);
    expect(getRetryAfterSeconds(limited('invalid'))).toBe(60);
    expect(
      getRetryAfterSeconds(limited(new Date(Date.now() + 10000).toUTCString())),
    ).toBeGreaterThan(0);
  });
  it('preserves meaningful structured server errors', () => {
    expect(
      getErrorMessage(
        limited('30', {
          success: false,
          error: {
            code: 'MEMBER_LOCKED',
            message: 'Tài khoản tạm khóa do đăng nhập sai nhiều lần.',
          },
        }),
      ),
    ).toBe('Tài khoản tạm khóa do đăng nhập sai nhiều lần.');
  });
});
