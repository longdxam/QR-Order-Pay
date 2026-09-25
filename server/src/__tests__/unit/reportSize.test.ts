import { describe, expect, it } from 'vitest';
import { assertReportResultSize } from '../../services/backgroundJobWorker.js';

describe('report result size limit', () => {
  it('accepts results within the configured byte budget', () => {
    expect(() => assertReportResultSize({ total: 35_000 }, 64)).not.toThrow();
  });

  it('rejects oversized UTF-8 results before storing them in Redis', () => {
    expect(() => assertReportResultSize('cà-phê', 4)).toThrow('REPORT_RESULT_TOO_LARGE');
  });
});
