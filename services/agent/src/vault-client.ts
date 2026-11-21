import type { SignedEventRequest } from "./signed-event.ts";

export type FetchCompatible = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text?: () => Promise<string>;
}>;

export interface VaultEventAcknowledgement {
  [key: string]: unknown;
  status: "accepted";
  sourceId: string;
  deliveryId: string;
  duplicate: boolean;
}

export class VaultClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchCompatible;

  constructor(baseUrl: string, fetchImpl: FetchCompatible = globalThis.fetch as FetchCompatible) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetchImpl = fetchImpl;
  }

  async ingestEvent(request: SignedEventRequest): Promise<VaultEventAcknowledgement> {
    let response;
    try {
      response = await this.fetchImpl(
        `${this.baseUrl}/api/v1/logs/ingest`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(request),
        },
      );
    } catch (error) {
      throw error instanceof Error
        ? error
        : new Error(`Vault ingest network error: ${String(error)}`);
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Vault ingest HTTP error: ${response.status}`);
    }

    let acknowledgement: unknown;
    try {
      acknowledgement = await response.json();
    } catch (error) {
      throw new Error(
        `Vault ingest returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (typeof acknowledgement !== "object" || acknowledgement === null) {
      throw new Error("Vault ingest returned an invalid acknowledgement envelope");
    }

    const receipt = acknowledgement as Record<string, unknown>;
    if (
      receipt.status !== "accepted" ||
      typeof receipt.sourceId !== "string" ||
      typeof receipt.deliveryId !== "string" ||
      typeof receipt.duplicate !== "boolean"
    ) {
      throw new Error("Vault ingest returned an invalid acknowledgement envelope");
    }

    if (
      receipt.sourceId !== request.sourceId ||
      receipt.deliveryId !== request.deliveryId
    ) {
      throw new Error(
        "Vault ingest acknowledgement sourceId or deliveryId does not match the request",
      );
    }

    if (
      (response.status === 201 && receipt.duplicate === false) ||
      (response.status === 200 && receipt.duplicate === true)
    ) {
      return receipt as VaultEventAcknowledgement;
    }

    throw new Error(
      `Vault ingest acknowledgement is invalid for HTTP ${response.status}`,
    );
  }
}
