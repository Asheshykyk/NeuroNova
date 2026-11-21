import type { DurableSpool } from "./durable-spool.ts";
import type { VaultClient, VaultEventAcknowledgement } from "./vault-client.ts";
import type { SignedEventRequest } from "./signed-event.ts";

export interface IngestClient {
  ingestEvent(
    request: SignedEventRequest,
  ): Promise<VaultEventAcknowledgement>;
}

export class SpoolDeliveryWorker {
  private readonly spool: DurableSpool;
  private readonly vaultClient: IngestClient;

  constructor(spool: DurableSpool, vaultClient: IngestClient | VaultClient) {
    this.spool = spool;
    this.vaultClient = vaultClient;
  }

  async deliverOnce(): Promise<number> {
    const pending = await this.spool.listPending();
    let acknowledged = 0;

    for (const request of pending) {
      await this.vaultClient.ingestEvent(request);
      await this.spool.acknowledge(request.deliveryId);
      acknowledged++;
    }

    return acknowledged;
  }
}
