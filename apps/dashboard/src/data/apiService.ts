import type { ApiTransport } from './apiTransport';

type SequenceFilter = string;

type CursorListOptions = {
  cursor?: string;
  limit?: number;
};

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export type CursorListQuery = CursorListOptions & (
  | {
      sourceId: string;
      sequenceFrom?: SequenceFilter;
      sequenceTo?: SequenceFilter;
    }
  | {
      sourceId?: never;
      sequenceFrom?: never;
      sequenceTo?: never;
    }
);

export function buildCursorQuery(query: CursorListQuery): URLSearchParams {
  const hasSequenceFilter = query.sequenceFrom !== undefined || query.sequenceTo !== undefined;
  if (hasSequenceFilter && !query.sourceId) {
    throw new TypeError('sourceId is required with sequenceFrom or sequenceTo');
  }

  const limit = query.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError('limit must be an integer between 1 and 100');
  }

  const params = new URLSearchParams();
  if (query.cursor !== undefined) params.set('cursor', query.cursor);
  params.set('limit', String(limit));
  if (query.sourceId !== undefined) params.set('sourceId', query.sourceId);
  if (query.sequenceFrom !== undefined) {
    if (!/^\d+$/.test(query.sequenceFrom)) throw new TypeError('sequenceFrom must be a decimal string');
    params.set('sequenceFrom', query.sequenceFrom);
  }
  if (query.sequenceTo !== undefined) {
    if (!/^\d+$/.test(query.sequenceTo)) throw new TypeError('sequenceTo must be a decimal string');
    params.set('sequenceTo', query.sequenceTo);
  }
  return params;
}

export interface ApiGetOptions<T> {
  validate: (value: unknown) => value is T;
  query?: CursorListQuery;
  signal?: AbortSignal;
}

export class DashboardApiService {
  constructor(private readonly transport: ApiTransport) {}

  get<T>(path: string, options: ApiGetOptions<T>): Promise<T> {
    const query = options.query ? buildCursorQuery(options.query).toString() : '';
    const requestPath = query
      ? `${path}${path.includes('?') ? '&' : '?'}${query}`
      : path;

    return this.transport.request(requestPath, {
      method: 'GET',
      signal: options.signal,
      validate: options.validate,
    });
  }
}
