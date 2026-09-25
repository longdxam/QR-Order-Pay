import type { RealtimeEventEnvelope } from '@may-cafe/contracts';
import { describe, expect, it } from 'vitest';
import { RealtimeEventGate } from '../lib/socket';

function envelope(eventId: string, entityId: string, entityVersion: number): RealtimeEventEnvelope {
  return {
    eventId,
    eventType: 'order.statusChanged',
    schemaVersion: 1,
    entityId,
    entityVersion,
    occurredAt: new Date().toISOString(),
    data: { orderId: entityId },
  };
}

describe('RealtimeEventGate', () => {
  it('rejects duplicate events and old entity versions while accepting version gaps', () => {
    const gate = new RealtimeEventGate();
    expect(gate.accept(envelope('event-1', 'order-1', 1))).toBe(true);
    expect(gate.accept(envelope('event-1', 'order-1', 1))).toBe(false);
    expect(gate.accept(envelope('event-old', 'order-1', 1))).toBe(false);
    expect(gate.accept(envelope('event-3', 'order-1', 3))).toBe(true);
    expect(gate.accept(envelope('event-2', 'order-1', 2))).toBe(false);
  });

  it('tracks versions independently and resets only version ordering after reconnect', () => {
    const gate = new RealtimeEventGate();
    expect(gate.accept(envelope('a-2', 'order-a', 2))).toBe(true);
    expect(gate.accept(envelope('b-1', 'order-b', 1))).toBe(true);
    gate.resetVersions();
    expect(gate.accept(envelope('a-1', 'order-a', 1))).toBe(true);
    expect(gate.accept(envelope('a-2', 'order-a', 2))).toBe(false);
  });
});
