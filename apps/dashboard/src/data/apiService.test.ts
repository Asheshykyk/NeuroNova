import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiTransport } from './apiTransport';
import { buildCursorQuery, DashboardApiService, type CursorPage } from './apiService';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DashboardApiService', () => {
  it('uses cursor in requests and preserves nextCursor in a validated response', async () => {
    const response = { items: [], nextCursor: 'opaque-next-page' };
    const fetch = vi.fn(async (_url: RequestInfo | URL) => ({
      ok: true,
      status: 200,
      json: async () => response,
    }));
    vi.stubGlobal('fetch', fetch);
    const service = new DashboardApiService(new ApiTransport({
      baseUrl: 'https://api.example',
      timeoutMs: 100,
    }));
    const isPage = (value: unknown): value is CursorPage<unknown> =>
      typeof value === 'object'
      && value !== null
      && 'items' in value
      && Array.isArray(value.items)
      && 'nextCursor' in value
      && (typeof value.nextCursor === 'string' || value.nextCursor === null);

    await expect(service.get('/test-only', {
      query: { cursor: 'opaque-current-page' },
      validate: isPage,
    })).resolves.toEqual(response);

    const [url] = fetch.mock.calls[0];
    expect(String(url)).toContain('cursor=opaque-current-page');
    expect(String(url)).toContain('limit=50');
    expect(String(url)).not.toContain('nextCursor');
  });

  it('requires sourceId for either source-local sequence filter', () => {
    expect(() => Reflect.apply(buildCursorQuery, undefined, [
      { sequenceFrom: '10' },
    ])).toThrow('sourceId is required');
    expect(() => Reflect.apply(buildCursorQuery, undefined, [
      { sequenceTo: '20' },
    ])).toThrow('sourceId is required');
  });

  it('serializes sequence filters only with their source', () => {
    const params = buildCursorQuery({
      sourceId: 'host-lab-01',
      sequenceFrom: '10',
      sequenceTo: 20,
      limit: 100,
    });

    expect(params.get('sourceId')).toBe('host-lab-01');
    expect(params.get('sequenceFrom')).toBe('10');
    expect(params.get('sequenceTo')).toBe('20');
    expect(params.get('limit')).toBe('100');
  });

  it('does not request more than the maximum page size', () => {
    expect(() => buildCursorQuery({ limit: 101 })).toThrow(RangeError);
  });
});
