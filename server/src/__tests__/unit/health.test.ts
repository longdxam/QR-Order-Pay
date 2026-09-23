import http from 'node:http';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../app.js';
import { closeHttpServer } from '../../infrastructure/lifecycle.js';

describe('health endpoints', () => {
  it('keeps liveness independent from dependencies', async () => {
    const app = buildApp({ readinessProbe: async () => false });
    const response = await request(app).get('/healthz').expect(200);
    expect(response.body).toMatchObject({ status: 'ok' });
    expect(response.body.instanceId).toEqual(expect.any(String));
  });

  it('reports ready only when MongoDB responds', async () => {
    const ready = buildApp({ readinessProbe: async () => true, redisReadinessProbe: () => true });
    const readyResponse = await request(ready).get('/readyz').expect(200);
    expect(readyResponse.body).toEqual({
      status: 'ready',
      instanceId: expect.any(String),
      dependencies: { mongodb: 'ready', redis: 'ready' },
    });

    const unavailable = buildApp({ readinessProbe: async () => false, redisReadinessProbe: () => true });
    const unavailableResponse = await request(unavailable).get('/readyz').expect(503);
    expect(unavailableResponse.body).toEqual({
      status: 'not_ready',
      instanceId: expect.any(String),
      dependencies: { mongodb: 'unavailable', redis: 'ready' },
    });

    const failedProbe = buildApp({ readinessProbe: async () => Promise.reject(new Error('ping failed')), redisReadinessProbe: () => false });
    const failedResponse = await request(failedProbe).get('/readyz').expect(503);
    expect(failedResponse.body).toEqual({
      status: 'not_ready',
      instanceId: expect.any(String),
      dependencies: { mongodb: 'unavailable', redis: 'unavailable' },
    });

    const degraded = buildApp({ readinessProbe: async () => true, redisReadinessProbe: () => false });
    const degradedResponse = await request(degraded).get('/readyz').expect(200);
    expect(degradedResponse.body).toEqual({
      status: 'degraded',
      instanceId: expect.any(String),
      dependencies: { mongodb: 'ready', redis: 'unavailable' },
    });
  });
});

describe('HTTP lifecycle', () => {
  it('stops accepting requests and closes a listening server', async () => {
    const server = http.createServer((_req, res) => res.end('ok'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const result = await closeHttpServer(server, 1_000);
    expect(result).toEqual({ forced: false });
    expect(server.listening).toBe(false);
  });

  it('is safe when the server has not started', async () => {
    const server = http.createServer();
    await expect(closeHttpServer(server, 1_000)).resolves.toEqual({ forced: false });
  });
});
