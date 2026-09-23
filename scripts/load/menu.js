import http from 'k6/http';
import { check } from 'k6';
import { Rate } from 'k6/metrics';

const baseUrl = __ENV.BASE_URL || 'http://web:8080';
const stageDuration = __ENV.STAGE_DURATION || '20s';
const warmupDuration = __ENV.WARMUP_DURATION || '15s';
export const unexpectedErrors = new Rate('unexpected_errors');

export const options = {
  scenarios: {
    menu_rps_steps: {
      executor: 'ramping-arrival-rate',
      startRate: 25,
      timeUnit: '1s',
      preAllocatedVUs: Number(__ENV.PRE_ALLOCATED_VUS || 250),
      maxVUs: Number(__ENV.MAX_VUS || 2000),
      stages: [
        { target: 25, duration: warmupDuration },
        ...[25, 50, 100, 200, 400, 600, 700].map((target) => ({ target, duration: stageDuration })),
      ],
      gracefulStop: '10s',
    },
  },
  thresholds: {
    unexpected_errors: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
    dropped_iterations: ['count==0'],
  },
};

export default function () {
  const response = http.get(`${baseUrl}/api/v1/products`, { tags: { endpoint: 'menu-read' } });
  const ok = check(response, { 'menu HTTP 200': (value) => value.status === 200 });
  unexpectedErrors.add(!ok);
}
