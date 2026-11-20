export interface BackendConfig {
  host: string;
  port: number;
}

function readPort(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return 3000;

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid BACKEND_PORT: ${value}`);
  }
  return port;
}

export const config: BackendConfig = {
  host: process.env.BACKEND_HOST?.trim() || '127.0.0.1',
  port: readPort(process.env.BACKEND_PORT)
};
