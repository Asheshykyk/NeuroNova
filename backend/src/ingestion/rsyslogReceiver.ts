import net, { type Socket } from 'node:net';
import type { EvidenceStore } from '../storage/evidenceStore.ts';

export interface RsyslogReceiverOptions {
  host: string;
  port: number;
  maxFrameBytes: number;
  store: EvidenceStore;
  onError?: (error: Error) => void;
}

export interface RsyslogEventBody {
  sourceId: string;
  streamId: string;
  fileIdentity: string;
  byteOffset: string;
  observedAt: string;
  rawEvent: string;
}

const UINT64_MAX = 0xffffffffffffffffn;

export class OctetCountedFrameParser {
  private buffer = Buffer.alloc(0);
  private expectedLength: number | null = null;
  private readonly maxFrameBytes: number;
  private readonly onFrame: (body: Buffer) => void;
  private readonly onError: (error: Error) => void;

  constructor(
    maxFrameBytes: number,
    onFrame: (body: Buffer) => void,
    onError: (error: Error) => void
  ) {
    this.maxFrameBytes = maxFrameBytes;
    this.onFrame = onFrame;
    this.onError = onError;
  }

  feed(chunk: Buffer): void {
    this.buffer = this.buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.buffer, chunk]);

    while (true) {
      if (this.expectedLength === null) {
        const separator = this.buffer.indexOf(0x20);
        if (separator < 0) {
          if (this.buffer.length > 20) {
            this.onError(new Error('Malformed or oversized octet-counted length prefix'));
            this.buffer = Buffer.alloc(0);
            this.expectedLength = null;
          }
          return;
        }

        const prefix = this.buffer.subarray(0, separator);
        if (prefix.length === 0 || !/^\d+$/.test(prefix.toString('ascii'))) {
          this.onError(new Error('Malformed octet-counted length prefix'));
          this.buffer = Buffer.alloc(0);
          this.expectedLength = null;
          return;
        }

        const lengthText = prefix.toString('ascii');
        const length = Number(lengthText);
        if (!Number.isSafeInteger(length) || length < 1) {
          this.onError(new Error('Invalid octet-counted frame length'));
          this.buffer = Buffer.alloc(0);
          this.expectedLength = null;
          return;
        }
        if (length > this.maxFrameBytes) {
          this.onError(new Error(`Rsyslog frame exceeds maximum size: ${length} > ${this.maxFrameBytes}`));
          this.buffer = Buffer.alloc(0);
          this.expectedLength = null;
          return;
        }

        this.expectedLength = length;
        this.buffer = this.buffer.subarray(separator + 1);
      }

      if (this.buffer.length < this.expectedLength) return;

      const body = Buffer.from(this.buffer.subarray(0, this.expectedLength));
      this.buffer = this.buffer.subarray(this.expectedLength);
      this.expectedLength = null;
      this.onFrame(body);
    }
  }

  end(): void {
    if (this.buffer.length > 0 || this.expectedLength !== null) {
      this.onError(new Error('Incomplete octet-counted frame at socket end'));
    }
    this.buffer = Buffer.alloc(0);
    this.expectedLength = null;
  }
}

function parseDecimalUint64(value: unknown, fieldName: string): bigint {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new Error(`${fieldName} must be a decimal string`);
  }
  const parsed = BigInt(value);
  if (parsed > UINT64_MAX) {
    throw new Error(`${fieldName} exceeds uint64 range`);
  }
  return parsed;
}

function requiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${fieldName} is required and must be a string`);
  }
  return value;
}

export async function processRsyslogFrame(store: EvidenceStore, body: Buffer): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch (error) {
    throw new Error('Rsyslog frame body is not valid JSON', { cause: error });
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Rsyslog frame body must be a JSON object');
  }

  const event = parsed as Partial<RsyslogEventBody>;
  const sourceId = requiredString(event.sourceId, 'sourceId');
  const streamId = requiredString(event.streamId, 'streamId');
  const fileIdentity = requiredString(event.fileIdentity, 'fileIdentity');
  const byteOffset = parseDecimalUint64(event.byteOffset, 'byteOffset');
  const observedAt = parseDecimalUint64(event.observedAt, 'observedAt');
  const rawEvent = requiredString(event.rawEvent, 'rawEvent');

  const rawEventBytes = Buffer.from(rawEvent, 'utf8');
  if (rawEventBytes.length === 0) {
    throw new Error('rawEvent must not be empty');
  }

  await store.append({
    sourceId,
    rawEventBytes,
    streamId,
    fileIdentity,
    byteOffset,
    observedAt,
    observationSource: 'rsyslog-tcp'
  });
}

export class RsyslogReceiver {
  readonly server: net.Server;
  private readonly sockets = new Set<Socket>();
  private readonly options: RsyslogReceiverOptions;

  constructor(options: RsyslogReceiverOptions) {
    this.options = options;
    this.server = net.createServer((socket) => {
      this.sockets.add(socket);

      const parser = new OctetCountedFrameParser(
        options.maxFrameBytes,
        (body) => {
          void processRsyslogFrame(options.store, body).catch((error) => {
            options.onError?.(error instanceof Error ? error : new Error(String(error)));
          });
        },
        (error) => {
          options.onError?.(error);
          socket.destroy();
        }
      );

      socket.on('data', (chunk: Buffer) => parser.feed(chunk));
      socket.on('end', () => parser.end());
      socket.on('close', () => this.sockets.delete(socket));
      socket.on('error', (error) => {
        options.onError?.(error);
        this.sockets.delete(socket);
      });
    });
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        this.server.off('error', onError);
        resolve();
      };
      this.server.once('error', onError);
      this.server.once('listening', onListening);
      this.server.listen(this.options.port, this.options.host);
    });
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.sockets.clear();

    await new Promise<void>((resolve, reject) => {
      if (!this.server.listening) {
        resolve();
        return;
      }
      this.server.close((error) => error ? reject(error) : resolve());
    });
  }
}
