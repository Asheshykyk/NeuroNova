export type WebSocketConnectionState =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'reconnecting';

export type WebSocketFactory = (endpoint: string) => WebSocket;

export interface WebSocketTransportOptions {
  endpoint: string;
  factory?: WebSocketFactory;
  maxAttempts?: number;
  initialDelayMs?: number;
  onStateChange?: (state: WebSocketConnectionState) => void;
  onReconnectRefetch?: () => void | Promise<void>;
}

export class WebSocketTransport {
  private socket?: WebSocket;
  private reconnectTimer?: number;
  private attempts = 0;
  private disposed = false;
  private readonly factory: WebSocketFactory;
  private readonly maxAttempts: number;
  private readonly initialDelayMs: number;

  constructor(private readonly options: WebSocketTransportOptions) {
    this.factory = options.factory ?? ((endpoint) => new WebSocket(endpoint));
    this.maxAttempts = options.maxAttempts ?? 5;
    this.initialDelayMs = options.initialDelayMs ?? 500;
  }

  connect(): void {
    if (this.disposed) return;
    this.setState('connecting');
    const socket = this.factory(this.options.endpoint);
    this.socket = socket;

    socket.onopen = () => {
      const reconnected = this.attempts > 0;
      this.attempts = 0;
      this.setState('connected');
      if (reconnected) void this.options.onReconnectRefetch?.();
    };

    socket.onclose = () => {
      if (this.disposed) return;
      this.setState('reconnecting');
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      socket.close();
    };
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
      this.socket.close();
      this.socket = undefined;
    }
  }
}
