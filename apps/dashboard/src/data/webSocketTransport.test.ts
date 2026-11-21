import { afterEach, describe, expect, it, vi } from 'vitest';
import { proposedWebSocketPath, WebSocketTransport } from './webSocketTransport';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  close = vi.fn();
}

function fakeFactory(sockets: FakeWebSocket[]) {
  return (endpoint: string): WebSocket => {
    expect(endpoint).not.toContain('token=');
    const socket = new FakeWebSocket();
    sockets.push(socket);
    return socket as unknown as WebSocket;
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('WebSocketTransport', () => {
  it('requires an explicit non-empty source subscription scope', () => {
    expect(() => new WebSocketTransport({
      endpoint: 'wss://example.invalid/api/v1/ws',
      sourceIds: [],
      factory: fakeFactory([]),
      onConnectionReady: vi.fn(),
      onReconnectRefetch: vi.fn(),
    })).toThrow('At least one non-empty sourceId is required');
  });

  it('rejects credentials and query parameters in the WebSocket endpoint', () => {
    expect(() => new WebSocketTransport({
      endpoint: 'wss://user:placeholder@example.invalid/api/v1/ws?ticket=placeholder',
      sourceIds: ['host-lab-01'],
      factory: fakeFactory([]),
      onConnectionReady: vi.fn(),
      onReconnectRefetch: vi.fn(),
    })).toThrow('without credentials or query parameters');
  });

  it('keeps the proposed path labeled as such and tracks bounded exponential reconnects', () => {
    vi.useFakeTimers();
    const sockets: FakeWebSocket[] = [];
    const states: string[] = [];
    const transport = new WebSocketTransport({
      endpoint: 'wss://example.invalid/api/v1/ws',
      sourceIds: ['host-lab-01'],
      onConnectionReady: vi.fn(),
      maxAttempts: 2,
      initialDelayMs: 100,
      factory: fakeFactory(sockets),
      onStateChange: (state) => states.push(state),
      onReconnectRefetch: vi.fn(),
    });

    expect(proposedWebSocketPath).toBe('/api/v1/ws');
    transport.connect();
    sockets[0].onclose?.();
    expect(states).toContain('reconnecting');
    vi.advanceTimersByTime(100);
    expect(sockets).toHaveLength(2);

    sockets[1].onclose?.();
    vi.advanceTimersByTime(200);
    expect(sockets).toHaveLength(3);
  });

  it('subscribes through an integration hook and refetches REST after reconnect', () => {
    vi.useFakeTimers();
    const sockets: FakeWebSocket[] = [];
    const ready = vi.fn();
    const refetch = vi.fn();
    const transport = new WebSocketTransport({
      endpoint: 'wss://example.invalid/api/v1/ws',
      sourceIds: ['host-lab-01'],
      factory: fakeFactory(sockets),
      onConnectionReady: ready,
      onReconnectRefetch: refetch,
    });

    transport.connect();
    sockets[0].onopen?.();
    expect(ready).toHaveBeenCalledWith(sockets[0], ['host-lab-01']);
    expect(refetch).not.toHaveBeenCalled();

    sockets[0].onclose?.();
    vi.advanceTimersByTime(500);
    sockets[1].onopen?.();
    expect(ready).toHaveBeenLastCalledWith(sockets[1], ['host-lab-01']);
    expect(refetch).toHaveBeenCalledOnce();

    transport.disconnect();
    expect(sockets[1].onmessage).toBeNull();
    expect(sockets[1].close).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(10_000);
    expect(sockets).toHaveLength(2);
  });

  it('deduplicates notifications by messageId, not evidence identity', () => {
    const sockets: FakeWebSocket[] = [];
    const onNotification = vi.fn();
    const transport = new WebSocketTransport({
      endpoint: 'wss://example.invalid/api/v1/ws',
      sourceIds: ['host-lab-01'],
      factory: fakeFactory(sockets),
      onConnectionReady: vi.fn(),
      onNotification,
      onReconnectRefetch: vi.fn(),
    });

    transport.connect();
    const notify = (messageId: string, value: string) => {
      sockets[0].onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({
          messageId,
          occurredAt: '2026-11-20T10:00:01.000Z',
          type: 'event.persisted',
          sourceId: 'host-lab-01',
          payload: {
            eventId: 'host-lab-01:4',
            vaultSequence: 4,
            value,
          },
        }),
      }));
    };

    notify('notification-1', 'first');
    notify('notification-1', 'duplicate notification');
    notify('notification-2', 'same evidence, separate notification');
    expect(onNotification).toHaveBeenCalledTimes(2);
    transport.disconnect();
  });

  it('reports malformed notification envelopes and cleans up on disconnect', () => {
    const sockets: FakeWebSocket[] = [];
    const onProtocolError = vi.fn();
    const onNotification = vi.fn();
    const transport = new WebSocketTransport({
      endpoint: 'wss://example.invalid/api/v1/ws',
      sourceIds: ['host-lab-01'],
      factory: fakeFactory(sockets),
      onConnectionReady: vi.fn(),
      onProtocolError,
      onNotification,
      onReconnectRefetch: vi.fn(),
    });

    transport.connect();
    sockets[0].onmessage?.(new MessageEvent('message', { data: '{"type":"event.persisted"}' }));
    expect(onProtocolError).toHaveBeenCalledOnce();
    expect(onNotification).not.toHaveBeenCalled();

    transport.disconnect();
    expect(sockets[0].onopen).toBeNull();
    expect(sockets[0].onmessage).toBeNull();
    expect(sockets[0].close).toHaveBeenCalledOnce();
  });

  it('stops reconnecting after the configured bound', () => {
    vi.useFakeTimers();
    const sockets: FakeWebSocket[] = [];
    const states: string[] = [];
    const transport = new WebSocketTransport({
      endpoint: 'wss://example.invalid/api/v1/ws',
      sourceIds: ['host-lab-01'],
      maxAttempts: 2,
      initialDelayMs: 100,
      factory: fakeFactory(sockets),
      onConnectionReady: vi.fn(),
      onStateChange: (state) => states.push(state),
      onReconnectRefetch: vi.fn(),
    });

    transport.connect();
    sockets[0].onclose?.();
    vi.advanceTimersByTime(100);
    sockets[1].onclose?.();
    vi.advanceTimersByTime(200);
    sockets[2].onclose?.();
    expect(states.at(-1)).toBe('disconnected');
    expect(sockets).toHaveLength(3);
  });
});
