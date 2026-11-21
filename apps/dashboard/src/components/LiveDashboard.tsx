import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { CursorPage } from '../data/apiService';
import { eventIdentity } from '../data/eventOrdering';
import { LiveVerification } from './LiveVerification';
import type { LiveDashboardAdapter, VaultEvent, VaultEventDetail } from '../data/liveDashboardAdapter';
import type { ViewId } from '../types';
import { StatusBadge } from './StatusBadge';

type PageLoader<T> = (cursor: string | undefined, signal: AbortSignal) => Promise<CursorPage<T>>;
type PageState<T> = { items: T[]; nextCursor: string | null; loading: boolean; error?: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Vault request failed.';
}

function usePages<T>(load: PageLoader<T>, keyOf: (item: T) => string) {
  const [state, setState] = useState<PageState<T>>({ items: [], nextCursor: null, loading: true });
  const [request, setRequest] = useState<{ cursor?: string }>({});

  useEffect(() => {
    const controller = new AbortController();
    const { cursor } = request;
    void load(cursor, controller.signal).then((page) => {
      if (controller.signal.aborted) return;
      setState((previous) => {
        const items = new Map((cursor === undefined ? [] : previous.items).map((item) => [keyOf(item), item]));
        for (const item of page.items) items.set(keyOf(item), item);
        return {
          items: [...items.values()],
          nextCursor: page.items.length === 0 || page.nextCursor === cursor ? null : page.nextCursor,
          loading: false,
        };
      });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setState((previous) => ({ ...previous, loading: false, error: errorMessage(error) }));
      }
    });
    return () => controller.abort();
  }, [request, load, keyOf]);

  function requestPage(cursor?: string) {
    setState((previous) => ({ ...previous, loading: true, error: undefined }));
    setRequest({ cursor });
  }

  return { ...state, requestPage };
}

function PageControls<T>({ page, empty }: { page: ReturnType<typeof usePages<T>>; empty: string }) {
  return (
    <>
      <div className="panel-heading">
        <button className="text-button" onClick={() => page.requestPage()} disabled={page.loading}>Refresh</button>
        {page.nextCursor && (
          <button className="text-button" onClick={() => page.requestPage(page.nextCursor ?? undefined)} disabled={page.loading}>
            Load more
          </button>
        )}
      </div>
      {page.loading && <p role="status">Loading Vault data…</p>}
      {page.error && <p role="alert">{page.error}</p>}
      {!page.loading && !page.error && page.items.length === 0 && <p role="status">{empty}</p>}
    </>
  );
}

function LiveHeading({ title, children }: { title: string; children?: ReactNode }) {
  return <header className="page-heading"><div><h1>{title}</h1>{children}</div></header>;
}

const sourceKey = (item: { sourceId: string }) => item.sourceId;
const eventKey = (event: VaultEvent) => eventIdentity(event.sourceId, event.vaultSequence);
const batchKey = (batch: { batchId: string }) => batch.batchId;
const gapKey = (gap: { sourceId: string; startSequence: string }) => eventIdentity(gap.sourceId, gap.startSequence);

function EventDetail({ adapter, event }: { adapter: LiveDashboardAdapter; event: VaultEvent }) {
  const { sourceId, vaultSequence } = event;
  const [state, setState] = useState<{ detail?: VaultEventDetail; error?: string }>({});

  useEffect(() => {
    const controller = new AbortController();
    void adapter.getEventDetail(sourceId, vaultSequence, controller.signal).then((detail) => {
      if (!controller.signal.aborted) setState({ detail });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({ error: errorMessage(error) });
    });
    return () => controller.abort();
  }, [adapter, sourceId, vaultSequence]);

  if (state.error) return <p role="alert">{state.error}</p>;
  if (!state.detail) return <p role="status">Loading event detail…</p>;
  const { detail } = state;
  const preview = Array.from(detail.rawBytes.subarray(0, 256), (byte) => byte.toString(16).padStart(2, '0')).join(' ');

  return (
    <article className="panel detail">
      <h2>Event detail</h2>
      <dl>
        <div><dt>Event ID</dt><dd className="mono">{detail.eventId}</dd></div>
        <div><dt>Source ID</dt><dd className="mono">{detail.sourceId}</dd></div>
        <div><dt>Vault sequence</dt><dd>{detail.vaultSequence}</dd></div>
        <div><dt>Stream</dt><dd>{detail.streamId ?? 'Not supplied'}</dd></div>
        <div><dt>File identity</dt><dd>{event.fileIdentity ?? 'Not supplied'}</dd></div>
        <div><dt>Byte offset</dt><dd>{event.byteOffset ?? 'Not supplied'}</dd></div>
        <div><dt>Payload SHA-256 (server reported)</dt><dd className="mono">{detail.payloadSha256}</dd></div>
        <div><dt>Raw event length</dt><dd>{detail.rawBytes.length} bytes</dd></div>
        <div><dt>Signature</dt><dd>Unavailable</dd></div>
        <div><dt>Merkle proof</dt><dd>{detail.merkleProof ? 'Supplied by Vault' : 'Unavailable'}</dd></div>
      </dl>
      <p>Raw bytes in hexadecimal{detail.rawBytes.length > 256 ? ' (first 256 bytes)' : ''}</p>
      <textarea aria-label="Raw event bytes in hexadecimal" readOnly value={preview} />
    </article>
  );
}

function EventPage({ adapter, sourceId, view }: {
  adapter: LiveDashboardAdapter; sourceId?: string; view: 'overview' | 'live-feed' | 'explorer';
}) {
  const [selectedKey, setSelectedKey] = useState<string>();
  const load = useCallback<PageLoader<VaultEvent>>((cursor, signal) =>
    adapter.getEvents({ sourceId, cursor, limit: view === 'overview' ? 4 : undefined }, signal), [adapter, sourceId, view]);
  const page = usePages(load, eventKey);
  const selected = page.items.find((event) => eventKey(event) === selectedKey);

  return (
    <>
      <article className="panel">
        <PageControls page={page} empty="No events returned by Vault." />
        {page.items.length > 0 && (
          <div className="table-wrap"><table>
            <thead><tr><th>Event</th><th>Stream / observation</th><th>Host timestamp</th><th>Vault received</th><th>Status</th></tr></thead>
            <tbody>{page.items.map((event) => (
              <tr key={eventKey(event)}>
                <td>
                  {view === 'explorer'
                    ? <button className="text-button" onClick={() => setSelectedKey(eventKey(event))}>Inspect #{event.vaultSequence}</button>
                    : <b>#{event.vaultSequence}</b>}
                  <small className="mono">{event.eventId}</small><small>{event.sourceId}</small>
                </td>
                <td>{event.streamId ?? 'Not supplied'}<small>{event.observationSource ?? 'Not supplied'}</small></td>
                <td>{event.hostTimestamp ?? 'Not supplied'}</td><td>{event.vaultReceivedAt}</td>
                <td>
                  <StatusBadge state={event.vaultPersistenceStatus} />
                  {event.localAnchorStatus && <StatusBadge state={event.localAnchorStatus} />}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </article>
      {selected && <EventDetail key={eventKey(selected)} adapter={adapter} event={selected} />}
    </>
  );
}

function Batches({ adapter, sourceId }: { adapter: LiveDashboardAdapter; sourceId?: string }) {
  const load = useCallback((cursor: string | undefined, signal: AbortSignal) =>
    adapter.getBatches({ sourceId, cursor }, signal), [adapter, sourceId]);
  const page = usePages(load, batchKey);
  return (
    <article className="panel">
      <h2>Vault batches</h2>
      <PageControls page={page} empty="No batches returned by Vault." />
      {page.items.map((batch) => (
        <div className="checkpoint" key={batch.batchId}>
          <div>
            <h3>Sequences {batch.startSequence}–{batch.endSequence}</h3>
            <p className="mono">{batch.sourceId}</p>
            <p className="mono">Merkle root {batch.merkleRoot}</p>
            <p className="mono">Commitment {batch.commitmentHash}</p>
            <p className="mono">Previous commitment {batch.previousCommitmentHash}</p>
          </div>
          <div>
            <StatusBadge state={batch.localAnchorStatus} />
            <p>Chain ID {batch.chainId ?? 'Not supplied'} · Block {batch.blockNumber ?? 'Not supplied'}</p>
            <p className="mono">{batch.transactionHash ?? 'No transaction hash supplied'}</p>
          </div>
        </div>
      ))}
    </article>
  );
}

function SequenceGaps({ adapter, sourceId }: { adapter: LiveDashboardAdapter; sourceId?: string }) {
  const load = useCallback((cursor: string | undefined, signal: AbortSignal) =>
    adapter.getSequenceGaps({ sourceId, cursor }, signal), [adapter, sourceId]);
  const page = usePages(load, gapKey);
  return (
    <article className="panel">
      <h2>Vault sequence gaps</h2>
      <PageControls page={page} empty="No sequence gaps returned by Vault." />
      {page.items.map((gap) => (
        <p key={gapKey(gap)}><b>SEQUENCE_GAP</b> · {gap.sourceId} · Missing sequences {gap.startSequence}–{gap.endSequence}</p>
      ))}
    </article>
  );
}

export function LiveDashboard({ adapter, view }: { adapter: LiveDashboardAdapter; view: ViewId }) {
  const [sourceId, setSourceId] = useState('');
  const load = useCallback((cursor: string | undefined, signal: AbortSignal) =>
    adapter.getSources({ cursor }, signal), [adapter]);
  const sources = usePages(load, sourceKey);
  const filter = sourceId || undefined;
  const title = {
    overview: 'Security evidence at a glance',
    'live-feed': 'Live evidence feed',
    explorer: 'Evidence explorer',
    verification: 'Host / Vault / Blockchain',
    recovery: 'Preservation after host change',
    checkpoints: 'Checkpoint status',
  }[view];
  const filterable = view !== 'verification';

  return (
    <section className="page">
      <LiveHeading title={title}>
        {view === 'live-feed' && <p>Live push is unavailable. Use Refresh to retrieve a new REST page.</p>}
        {view === 'verification' && <p>LIVE REST can request the server-side Auditor. DEMO fixtures never produce verification results.</p>}
        {view === 'recovery' && <p>Recovery status and collection-gap data are unavailable.</p>}
        {view === 'checkpoints' && <p>Public checkpoints are unavailable. Batch anchoring is server reported.</p>}
      </LiveHeading>
      {filterable && (
        <article className="panel">
          <label>Vault source <select className="source-select" value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
            <option value="">All sources</option>
            {sourceId && !sources.items.some((source) => source.sourceId === sourceId) && <option value={sourceId}>{sourceId}</option>}
            {sources.items.map((source) => (
              <option key={source.sourceId} value={source.sourceId}>{source.sourceId} ({source.eventCount} events)</option>
            ))}
          </select></label>
          {sources.nextCursor && <button className="text-button" disabled={sources.loading} onClick={() => sources.requestPage(sources.nextCursor ?? undefined)}>Load more sources</button>}
          {sources.error && <p role="alert">Sources: {sources.error} <button className="text-button" onClick={() => sources.requestPage()}>Retry sources</button></p>}
        </article>
      )}
      {(view === 'overview' || view === 'live-feed' || view === 'explorer') && (
        <EventPage key={`${view}:${sourceId}`} adapter={adapter} sourceId={filter} view={view} />
      )}
      {view === 'checkpoints' && <Batches key={sourceId} adapter={adapter} sourceId={filter} />}
      {view === 'recovery' && <SequenceGaps key={sourceId} adapter={adapter} sourceId={filter} />}
      {view === 'verification' && (
        <LiveVerification
          initialSourceId={sourceId || sources.items[0]?.sourceId || ''}
          sourcesLoading={sources.loading}
          sourcesError={sources.error}
        />
      )}
    </section>
  );
}
