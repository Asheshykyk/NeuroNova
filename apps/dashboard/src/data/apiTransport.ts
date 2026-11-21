export interface ApiTransportConfig {
  baseUrl: string;
  timeoutMs: number;
}

export class ApiTimeoutError extends Error {
  readonly name = 'ApiTimeoutError';
}

export class ApiCancellationError extends Error {
  readonly name = 'ApiCancellationError';
}

export class ApiTransport {
  constructor(private readonly config: ApiTransportConfig) {}

  async request<T>(
    path: string,
    options: RequestInit & { signal?: AbortSignal; validate: (value: unknown) => value is T },
  ): Promise<T> {
    const controller = new AbortController();
    const externalSignal = options.signal;
    const { validate, ...requestOptions } = options;
    const abortFromExternal = () => controller.abort();
    if (externalSignal?.aborted) {
      abortFromExternal();
    } else {
      externalSignal?.addEventListener('abort', abortFromExternal, { once: true });
    }

    const timeout = window.setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`, {
        ...requestOptions,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`API request failed (${response.status})`);
      }

      const value: unknown = await response.json();
      if (!validate(value)) {
        throw new Error('API response failed type validation');
      }
      return value;
    } catch (error) {
      if (controller.signal.aborted) {
        if (externalSignal?.aborted) throw new ApiCancellationError();
        throw new ApiTimeoutError();
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', abortFromExternal);
    }
  }
}
