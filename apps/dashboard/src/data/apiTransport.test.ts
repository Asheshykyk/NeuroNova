import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiCancellationError,
  ApiTimeoutError,
  ApiTransport,
} from './apiTransport';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('ApiTransport', () => {
  it('times out and aborts a request', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }),
    ));
    const transport = new ApiTransport({ baseUrl: 'https://api.example', timeoutMs: 50 });

    const pending = transport.request('/approved-resource', {
      validate: (value): value is string => typeof value === 'string',
    });
    const rejection = expect(pending).rejects.toBeInstanceOf(ApiTimeoutError);
    await vi.advanceTimersByTimeAsync(50);
    await rejection;
  });

  it('cancels with an AbortController', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }),
    ));
    const transport = new ApiTransport({ baseUrl: 'https://api.example', timeoutMs: 10_000 });

    const pending = transport.request('/approved-resource', {
      signal: controller.signal,
      validate: (value): value is object => typeof value === 'object',
    });
    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(ApiCancellationError);
  });

  it('validates typed response boundaries', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => 42,
    })));
    const transport = new ApiTransport({ baseUrl: 'https://api.example', timeoutMs: 100 });

    await expect(transport.request('/approved-resource', {
      validate: (value): value is { ok: true } => false,
    })).rejects.toThrow('type validation');
  });
});
