import { useCallback, useEffect, useRef } from 'react';
import { useSocketEvent } from '../../lib/socket';

interface OrderIdentity {
  _id: string;
}

export function useNewOrderAlerts(
  identity: string | undefined,
  tables: OrderIdentity[] | undefined,
  notify: (count: number) => void,
): void {
  const state = useRef({
    identity,
    seen: new Set<string>(),
    tablesReady: false,
  });
  if (state.current.identity !== identity)
    state.current = { identity, seen: new Set(), tablesReady: false };
  const remember = useCallback((id: string) => {
    const seen = state.current.seen;
    if (seen.has(id)) return false;
    seen.add(id);
    if (seen.size > 2000) seen.delete(seen.values().next().value!);
    return true;
  }, []);

  // Notify directly from creation, including unpaid orders. Polling catches
  // arrivals missed during a disconnect without treating initial history as new.
  useSocketEvent('order.created', (data) => {
    const order = data as { orderId?: string; tableSessionId?: string } | undefined;
    if (order?.tableSessionId && order.orderId && remember(order.orderId)) notify(1);
  });
  useEffect(() => {
    if (!tables) return;
    const count = tables.filter((item) => remember(item._id)).length;
    if (state.current.tablesReady && count > 0) notify(count);
    state.current.tablesReady = true;
  }, [tables, remember, notify]);
}
