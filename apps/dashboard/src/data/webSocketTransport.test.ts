import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketTransport } from './webSocketTransport';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
}

afterEach(() => {
  vi.useRealTimers();
});

describe('WebSocketTransport', () => {
  it('tracks reconnect state with bounded exponential backoff', () => {
    vi.useFakeTimers();
    const sockets: FakeWebSocket[] = [];
    const states: string[] = [];
    const transport = new WebSocketTransport({
      endpoint: 'wss://example.invalid/feed',
      maxAttempts: 2,
      initialDelayMs: 100,
      factory: (endpoint) => {
        expect(endpoint).toContain('wss://');
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      onStateChange: (state) => states.push(state),
    });

    transport.connect();
    sockets[0].onclose?.();
    expect(states).toContain('reconnecting');
    vi.advanceTimersByTime(100);
    expect(sockets).toHaveLength(2);

    sockets[1].onclose?.();
    vi.advanceTimersByTime(200);
    expect(sockets).toHaveLength(3);
  });

  it('triggers REST refetch after reconnect and cleans up', () => {
    vi.useFakeTimers();
    const sockets: FakeWebSocket[] = [];
    const refetch = vi.fn();
    const transport = new WebSocketTransport({
      endpoint: 'wss://example.invalid/feed',
      factory: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      onReconnectRefetch: refetch,
    });

    transport.connect();
    sockets[0].onclose?.();
    vi.advanceTimersByTime(500);
    sockets[1].onopen?.();
    expect(refetch).toHaveBeenCalledOnce();

    transport.disconnect();
    expect(sockets[1].close).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(10_000);
  });

  it('does not refetch when no approved read contract callback exists', () => {
    vi.useFakeTimers();
    const sockets: FakeWebSocket[] = [];
    const transport = new WebSocketTransport({
      endpoint: 'wss://example.invalid/feed',
      factory: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
    });

    transport.connect();
    sockets[0].onclose?.();
    vi.advanceTimersByTime(500);
    sockets[1].onopen?.();
    transport.disconnect();
    expect(sockets[1].close).toHaveBeenCalledOnce();
  });

  it('stops reconnecting after the configured bound', () => {
    vi.useFakeTimers();
    const sockets: FakeWebSocket[] = [];
    const states: string[] = [];
    const transport = new WebSocketTransport({
      endpoint: 'wss://example.invalid/feed',
      maxAttempts: 2,
      initialDelayMs: 100,
      factory: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      onStateChange: (state) => states.push(state),
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
