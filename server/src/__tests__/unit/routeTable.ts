import { createHash } from 'node:crypto';
import type { Router } from 'express';

/**
 * Express 4 không công khai kiểu của router.stack; đây là phần tối thiểu cần để đọc bảng route.
 */
interface Layer {
  route?: { path: string; methods: Record<string, boolean>; stack: Layer[] };
  handle: ((...args: unknown[]) => unknown) & { stack?: Layer[] };
  match(path: string): boolean;
}

export interface RouteEntry {
  method: string;
  path: string;
  /** Toàn bộ middleware thực sự chạy cho route này, theo đúng thứ tự, kể cả `router.use(prefix, ...)`. */
  chain: string[];
}

function handlerName(fn: Layer['handle']): string {
  if (fn.name && fn.name !== 'anonymous') return fn.name;
  return `<anon:${createHash('sha1').update(fn.toString()).digest('hex').slice(0, 8)}>`;
}

/**
 * Đọc router theo thứ tự đăng ký. Với mỗi route, gom các `use` middleware đứng trước có prefix khớp
 * đường dẫn route, rồi tới handler của route. Router con (mount ở gốc) được duyệt đệ quy; `use` trong
 * router con vẫn chạy cho request đi qua nó rồi sang router sau, nên danh sách `uses` là chung.
 */
export function listRoutes(router: Router): RouteEntry[] {
  const routes: RouteEntry[] = [];
  const uses: Array<{ layer: Layer; name: string }> = [];
  const walk = (stack: Layer[]): void => {
    for (const layer of stack) {
      if (layer.route) {
        const { path, methods, stack: handlers } = layer.route;
        for (const method of Object.keys(methods).filter((key) => methods[key])) {
          routes.push({
            method: method.toUpperCase(),
            path,
            chain: [
              ...uses.filter(({ layer: use }) => use.match(path)).map(({ name }) => name),
              ...handlers.map((handler) => handlerName(handler.handle)),
            ],
          });
        }
      } else if (layer.handle.stack) {
        walk(layer.handle.stack);
      } else {
        uses.push({ layer, name: handlerName(layer.handle) });
      }
    }
  };
  walk((router as unknown as { stack: Layer[] }).stack);
  return routes;
}
