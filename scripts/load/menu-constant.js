import http from 'k6/http';
import { check } from 'k6';
import { Rate } from 'k6/metrics';

const baseUrl = __ENV.BASE_URL || 'http://web:8080';
const targetRps = Number(__ENV.TARGET_RPS || 100);
export const unexpectedErrors = new Rate('unexpected_errors');

export const options = {
  scenarios: {
    warmup: {
      executor: 'constant-arrival-rate',
      rate: Math.min(targetRps, 25),
      timeUnit: '1s',
      duration: __ENV.WARMUP_DURATION || '5s',
      preAllocatedVUs: 50,
      maxVUs: 500,
    },
    measurement: {
      executor: 'constant-arrival-rate',
      startTime: __ENV.WARMUP_DURATION || '5s',
      rate: targetRps,
      timeUnit: '1s',
      duration: __ENV.DURATION || '20s',
      preAllocatedVUs: Number(__ENV.PRE_ALLOCATED_VUS || 250),
      maxVUs: Number(__ENV.MAX_VUS || 2000),
      tags: { phase: 'measurement' },
    },
  },
  thresholds: {
    'unexpected_errors{phase:measurement}': ['rate<0.01'],
    'http_req_duration{phase:measurement}': ['p(95)<500'],
    'dropped_iterations{scenario:measurement}': ['count==0'],
  },
};

export default function () {
  const response = http.get(`${baseUrl}/api/v1/products`, { tags: { endpoint: 'menu-read' } });
  const ok = check(response, { 'menu HTTP 200': (value) => value.status === 200 });
  unexpectedErrors.add(!ok);
}
