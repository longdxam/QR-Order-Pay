import type { Server } from 'node:http';

export interface CloseHttpServerResult {
  forced: boolean;
}

export async function closeHttpServer(server: Server, timeoutMs: number): Promise<CloseHttpServerResult> {
  if (!server.listening) return { forced: false };

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (result: CloseHttpServerResult, error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(result);
    };

    const timeout = setTimeout(() => {
      server.closeAllConnections();
      finish({ forced: true });
    }, timeoutMs);
    timeout.unref();

    server.close((error) => finish({ forced: false }, error));
    server.closeIdleConnections();
  });
}
