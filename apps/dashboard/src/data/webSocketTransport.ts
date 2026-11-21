export type WebSocketConnectionState =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'reconnecting';

export const proposedWebSocketPath = '/api/v1/ws';

/** Authentication is supplied by the caller; this transport never adds URL credentials. */
export type AuthenticatedWebSocketFactory = (endpoint: string) => WebSocket;

export interface WebSocketTransportOptions {
  endpoint: string;
  factory: AuthenticatedWebSocketFactory;
  sourceIds: readonly string[];
  /** Called after each connection so the integration can use its approved subscription schema. */
  onConnectionReady: (socket: WebSocket, sourceIds: readonly string[]) => void;
  maxAttempts?: number;
  initialDelayMs?: number;
  onStateChange?: (state: WebSocketConnectionState) => void;
  onNotification?: (event: MessageEvent) => void;
  onProtocolError?: (error: unknown) => void;
  onReconnectRefetch: () => void | Promise<void>;
  onReconciliationError?: (error: unknown) => void;
}

const messageIdCacheSize = 1_000;

function notificationMessageId(data: unknown): string {
  if (typeof data !== 'string') {
    throw new TypeError('WebSocket notification must be a JSON string');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw new TypeError('WebSocket notification is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || !('messageId' in parsed)) {
    throw new TypeError('WebSocket notification is missing messageId');
  }
  if (typeof parsed.messageId !== 'string' || parsed.messageId.length === 0) {
    throw new TypeError('WebSocket notification has an invalid messageId');
  }
  return parsed.messageId;
}

function validateEndpoint(endpoint: string): void {
  const url = new URL(endpoint);
  if (
    (url.protocol !== 'ws:' && url.protocol !== 'wss:')
    || (import.meta.env.PROD && url.protocol !== 'wss:')
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new TypeError('WebSocket endpoint must use ws/wss (WSS in production) without credentials or query parameters');
  }
}

export class WebSocketTransport {
  private socket?: WebSocket;
  private reconnectTimer?: number;
  private attempts = 0;
  private disposed = false;
  private readonly maxAttempts: number;
  private readonly initialDelayMs: number;
  private readonly sourceIds: readonly string[];
  private readonly seenMessageIds = new Set<string>();
  private readonly messageIdOrder: string[] = [];

  constructor(private readonly options: WebSocketTransportOptions) {
    validateEndpoint(options.endpoint);
    this.maxAttempts = options.maxAttempts ?? 5;
    this.initialDelayMs = options.initialDelayMs ?? 500;
    if (options.sourceIds.length === 0 || options.sourceIds.some((sourceId) => !sourceId.trim())) {
      throw new TypeError('At least one non-empty sourceId is required');
    }
    this.sourceIds = [...new Set(options.sourceIds)];
  }

  connect(): void {
    if (this.disposed) return;
    this.setState('connecting');
    const socket = this.options.factory(this.options.endpoint);
    this.socket = socket;

    socket.onopen = () => {
      const reconnected = this.attempts > 0;
      this.attempts = 0;
      this.setState('connected');
      this.options.onConnectionReady(socket, this.sourceIds);
      if (reconnected) this.refetchAfterReconnect();
    };

    socket.onmessage = (event) => {
      let messageId: string;
      try {
        messageId = notificationMessageId(event.data);
      } catch (error) {
        this.handleProtocolError(error);
        return;
      }
      if (!this.rememberMessageId(messageId)) return;
      this.options.onNotification?.(event);
    };

    socket.onclose = () => {
      socket.onmessage = null;
      if (this.disposed) return;
      this.setState('reconnecting');
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      socket.close();
    };
  }

  private rememberMessageId(messageId: string): boolean {
    if (this.seenMessageIds.has(messageId)) return false;
    this.seenMessageIds.add(messageId);
    this.messageIdOrder.push(messageId);
    if (this.messageIdOrder.length > messageIdCacheSize) {
      const expiredId = this.messageIdOrder.shift();
      if (expiredId !== undefined) this.seenMessageIds.delete(expiredId);
    }
    return true;
  }

  private refetchAfterReconnect(): void {
    try {
      const result = this.options.onReconnectRefetch();
      if (result && typeof result.then === 'function') {
        void result.catch((error: unknown) => this.handleReconciliationError(error));
      }
    } catch (error) {
      this.handleReconciliationError(error);
    }
  }

  private handleReconciliationError(error: unknown): void {
    if (this.options.onReconciliationError) {
      this.options.onReconciliationError(error);
      return;
    }
    console.error('REST reconciliation after WebSocket reconnect failed', error);
  }

  private handleProtocolError(error: unknown): void {
    if (this.options.onProtocolError) {
      this.options.onProtocolError(error);
      return;
    }
    console.error('Invalid WebSocket notification envelope', error);
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.attempts >= this.maxAttempts) {
      this.setState('disconnected');
      return;
    }
    const delay = Math.min(this.initialDelayMs * (2 ** this.attempts), 30_000);
    this.attempts += 1;
    this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
  }

  private setState(state: WebSocketConnectionState): void {
    this.options.onStateChange?.(state);
  }

  disconnect(): void {
    this.disposed = true;
    if (this.reconnectTimer !== undefined) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onclose = null;
      this.socket.onerror = null;
      this.socket.onmessage = null;
      this.socket.close();
      this.socket = undefined;
    }
  }
}
