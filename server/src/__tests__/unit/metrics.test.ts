import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../app.js';
import {
  getInstanceMetricsSnapshot,
  recordBusinessEvent,
  recordOrderStageDuration,
  resetApplicationMetricsForTests,
  socketConnected,
  socketDisconnected,
} from '../../infrastructure/metrics.js';

describe('application metrics', () => {
  beforeEach(() => resetApplicationMetricsForTests());

  it('exports HTTP metrics using bounded route templates, never the requested URL', async () => {
    const app = buildApp({ readinessProbe: async () => true });
    await request(app).get('/healthz').expect(200);
    await request(app).get('/api/v1/orders/a-real-order-id').expect(401);
    await request(app).get('/not-a-real-route/secret-value').expect(404);

    const response = await request(app).get('/metrics').expect(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.text).toContain('maycafe_http_requests_total');
    expect(response.text).toContain('route="/healthz"');
    expect(response.text).toContain('route="/orders/:id"');
    expect(response.text).toContain('route="unmatched"');
    expect(response.text).not.toContain('a-real-order-id');
    expect(response.text).not.toContain('secret-value');
  });

  it('tracks only explicitly recorded non-replayed business events', () => {
    recordBusinessEvent('order_created');
    recordBusinessEvent('payment_confirmed');
    const snapshot = getInstanceMetricsSnapshot();
    expect(snapshot.businessEvents.order_created).toBe(1);
    expect(snapshot.businessEvents.payment_confirmed).toBe(1);
  });

  it('summarizes completed order stage timings without identifiers', () => {
    recordOrderStageDuration('acceptance', 30);
    recordOrderStageDuration('acceptance', 90);
    recordOrderStageDuration('service', -1);
    const snapshot = getInstanceMetricsSnapshot();
    expect(snapshot.orderStageDurations.acceptance).toEqual({ count: 2, averageSeconds: 60 });
    expect(snapshot.orderStageDurations.service).toEqual({ count: 0, averageSeconds: null });
  });

  it('keeps socket gauges balanced and never below zero', () => {
    socketConnected('guest');
    socketConnected('staff');
    socketDisconnected('guest');
    socketDisconnected('guest');
    expect(getInstanceMetricsSnapshot().sockets).toEqual({ guest: 0, staff: 1 });
  });
});
