import { useState, type ReactNode } from 'react';
import { LiveDashboard } from './components/LiveDashboard';
import { Navigation } from './components/Navigation';
import { StatusBadge } from './components/StatusBadge';
import { createDashboardDataSource, type DashboardDataSource } from './data/source';
import type { EvidenceEvent, StatusBadgeState, ViewId } from './types';

function formatTime(value?: string) {
  if (!value) return 'Not supplied';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Invalid timestamp';
  return `${date.toLocaleString('en-GB', { timeZone: 'UTC', hour12: false })} UTC`;
}

function ModeTag({ mode }: { mode: DashboardDataSource['mode'] }) {
  return mode === 'demo'
    ? <span className="demo-tag">DEMO DATA</span>
    : <span className="mode-tag pending-mode-tag">LIVE REST</span>;
}

function PageHeading({
  mode,
  title,
  kicker,
  description,
  state,
}: {
  mode: DashboardDataSource['mode'];
  title: string;
  kicker: string;
  description: string;
  state: StatusBadgeState;
}) {
  return (
    <header className="page-heading">
      <div>
        <p className="eyebrow">{kicker} <ModeTag mode={mode} /></p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <StatusBadge state={state} />
    </header>
  );
}

function StatePanel({
  state,
  title,
  children,
}: {
  state: 'empty' | 'error' | 'disconnected' | 'stale' | 'loading';
  title: string;
  children: ReactNode;
}) {
  return (
    <article className={`empty-state state-panel state-panel-${state}`} role="status">
      <StatusBadge state={state} />
      <b>{title}</b>
      <div>{children}</div>
    </article>
  );
}

type DemoSource = Extract<DashboardDataSource, { mode: 'demo' }>;

function Metric({ mode, label, value, note }: {
  mode: DashboardDataSource['mode'];
  label: string;
  value: string;
  note: string;
}) {
  return (
    <article className="metric-card">
      <p>{label}</p>
      <strong>{value}</strong>
      <small>{note}</small>
      <ModeTag mode={mode} />
    </article>
  );
}

function EventTable({
  events,
  mode,
  onSelect,
}: {
  events: EvidenceEvent[];
  mode: DashboardDataSource['mode'];
  onSelect?: (event: EvidenceEvent) => void;
}) {
  if (events.length === 0) {
    return (
      <StatePanel state="empty" title="No event metadata">
        No event metadata has been returned for this view.
      </StatePanel>
    );
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Source-local event</th>
            <th>Stream / observation</th>
            <th>Observed at</th>
            <th>Vault received</th>
            <th>Persistence</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr
              key={event.eventId}
              onClick={() => onSelect?.(event)}
              className={onSelect ? 'selectable' : ''}
            >
              <td>
                <b>#{event.vaultSequence}</b>
                <small className="mono">{event.eventId}</small>
                <small>{event.sourceId}</small>
              </td>
              <td>
                {event.streamId}
                <small>{event.observationSource} · {event.correlationStatus}</small>
              </td>
              <td>{formatTime(event.observedAt)}</td>
              <td>{formatTime(event.vaultReceivedAt)}</td>
              <td><StatusBadge state={event.vaultPersistenceStatus} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="table-footnote">
        Static fixture data; not a live feed.
      </p>
    </div>
  );
}

function Overview({
  source,
  onNavigate,
}: {
  source: DemoSource;
  onNavigate: (view: ViewId) => void;
}) {
  const events = source.adapter.getEvents();
  const checkpoints = source.adapter.getCheckpoints();
  const gaps = source.adapter.getCollectionGaps();
  const metrics = [
    {
      label: 'Vault-persisted events',
      value: String(events.filter((event) => event.vaultPersistenceStatus === 'VAULT_PERSISTED').length),
      note: 'Fixture records only',
    },
    {
      label: 'Public anchor reports',
      value: String(checkpoints.filter((item) => item.publicAnchorStatus === 'ANCHORED_SERVER_REPORTED').length),
      note: 'Server-reported status; not RPC verified',
    },
    {
      label: 'RPC-verified commitments',
      value: String(checkpoints.filter((item) => item.independentVerificationStatus === 'RPC_VERIFIED').length),
      note: 'No independent result in this fixture',
    },
    {
      label: 'Collection gaps',
      value: String(gaps.length),
      note: 'Separate from evidence integrity',
    },
  ];

  return (
    <section className="page">
      <PageHeading
        mode={source.mode}
        kicker="Operational picture"
        title="Security evidence at a glance"
        description="All displayed records and statuses are DEMO fixtures. No backend, WebSocket, or direct RPC result is connected."
        state="disconnected"
      />
      <div className="metric-grid">
        {metrics.map((metric) => (
          <Metric key={metric.label} mode={source.mode} {...metric} />
        ))}
      </div>
      <div className="two-col">
        <article className="panel">
          <div className="panel-heading">
            <div><p className="eyebrow">Latest evidence</p><h2>Event metadata</h2></div>
            <button className="text-button" onClick={() => onNavigate('live-feed')}>View feed</button>
          </div>
          <EventTable events={events.slice(0, 4)} mode={source.mode} />
        </article>
        <article className="panel boundary">
          <p className="eyebrow">Evidence boundary</p>
          <h2>What this view can say</h2>
          <p>
            A server-reported anchor is not an independent RPC result. Missing chain proof is
            not a tampering finding, and an event-level Auditor result is distinct from
            checkpoint commitment verification.
          </p>
          <button className="text-button" onClick={() => onNavigate('verification')}>
            Inspect status dimensions
          </button>
        </article>
      </div>
    </section>
  );
}

function LiveFeed({ source }: { source: DemoSource }) {
  return (
    <section className="page">
      <PageHeading
        mode={source.mode}
        kicker="Live transport"
        title="Live evidence feed"
        description="The feed is disconnected in demo mode; records below are static fixtures."
        state="disconnected"
      />
      <StatePanel state="disconnected" title="DEMO feed is not a live stream">
        <p>Proposed target /api/v1/ws is not connected.</p>
        <p>No event.persisted notifications are fabricated from fixture data.</p>
      </StatePanel>
      <article className="panel">
        <p className="eyebrow">Static fixture records</p>
        <EventTable events={source.adapter.getEvents()} mode={source.mode} />
      </article>
    </section>
  );
}

function WitnessCard({
  title,
  summary,
  mode,
  children,
}: {
  title: string;
  summary: string;
  mode: DashboardDataSource['mode'];
  children: ReactNode;
}) {
  return (
    <article className="witness-card">
      <div className="panel-heading"><h2>{title}</h2><ModeTag mode={mode} /></div>
      <p>{summary}</p>
      {children}
    </article>
  );
}

function StatusDimension({ label, state }: { label: string; state: StatusBadgeState }) {
  return (
    <div className="status-dimension">
      <span>{label}</span>
      <StatusBadge state={state} />
    </div>
  );
}

function WitnessDetails({ details }: { details: Array<{ label: string; value?: string }> }) {
  return (
    <dl>
      {details.map((detail) => (
        <div key={detail.label}>
          <dt>{detail.label}</dt>
          <dd className="mono">{detail.value ?? 'Not supplied'}</dd>
        </div>
      ))}
    </dl>
  );
}

function Verification({ source }: { source: DemoSource }) {
  const snapshot = source.adapter.getVerification();
  if (!snapshot) {
    return (
      <section className="page">
        <PageHeading
          mode={source.mode}
          kicker="Witness comparison"
          title="Host / Vault / Blockchain"
          description="No live verification response schema is available."
          state="empty"
        />
        <StatePanel state="empty" title="No verification snapshot">No fixture snapshot is available.</StatePanel>
      </section>
    );
  }

  return (
    <section className="page">
      <PageHeading
        mode={source.mode}
        kicker="Witness comparison"
        title="Host / Vault / Blockchain"
        description="Persistence, anchoring, and independent verification are separate status dimensions."
        state="disconnected"
      />
      <div className="witness-grid">
        <WitnessCard title="Host comparison" summary={snapshot.host.summary} mode={source.mode}>
          {snapshot.host.demoComparison && (
            <p className="demo-outcome">DEMO comparison differs; this is not an Auditor CLI result.</p>
          )}
          <WitnessDetails details={snapshot.host.details} />
        </WitnessCard>
        <WitnessCard title="Vault persistence" summary={snapshot.vault.summary} mode={source.mode}>
          <StatusDimension label="Vault persistence" state={snapshot.vault.persistenceStatus} />
          <WitnessDetails details={snapshot.vault.details} />
        </WitnessCard>
        <WitnessCard title="Blockchain" summary={snapshot.blockchain.summary} mode={source.mode}>
          <div className="status-dimensions">
            <StatusDimension label="Local Hardhat anchoring" state={snapshot.blockchain.localAnchorStatus} />
            <StatusDimension label="Public Quai anchoring" state={snapshot.blockchain.publicAnchorStatus} />
            <StatusDimension label="Independent chain verification" state={snapshot.blockchain.independentVerificationStatus} />
          </div>
          <WitnessDetails details={snapshot.blockchain.details} />
        </WitnessCard>
      </div>
      <article className="panel conclusion">
        <p className="eyebrow">Auditor CLI boundary</p>
        <h2>No Auditor CLI result is loaded</h2>
        <p>
          This demo comparison did not run the verifier. UNVERIFIABLE means no integrity
          verdict; only an actual independent verification may produce an Auditor CLI outcome.
        </p>
      </article>
    </section>
  );
}

function Explorer({ source }: { source: DemoSource }) {
  const events = source.adapter.getEvents();
  const [selectedEventId, setSelectedEventId] = useState(
    () => events.find((event) => event.demo?.hostComparison)?.eventId ?? events[0]?.eventId,
  );
  const selected = events.find((event) => event.eventId === selectedEventId);

  if (!selected) {
    return (
      <section className="page">
        <PageHeading
          mode={source.mode}
          kicker="Evidence inspection"
          title="Evidence explorer"
          description="Raw evidence is not part of event metadata responses."
          state="empty"
        />
        <StatePanel state="empty" title="No event metadata">No fixture records are available.</StatePanel>
      </section>
    );
  }

  return (
    <section className="page">
      <PageHeading
        mode={source.mode}
        kicker="Evidence inspection"
        title="Evidence explorer"
        description="Event metadata and raw evidence are separate. Any preview below is fixture-only."
        state="disconnected"
      />
      <div className="explorer-grid">
        <article className="panel">
          <p className="eyebrow">Available records <ModeTag mode={source.mode} /></p>
          {events.map((event) => (
            <button
              className={`record ${event.eventId === selected.eventId ? 'selected' : ''}`}
              onClick={() => setSelectedEventId(event.eventId)}
              key={event.eventId}
              aria-pressed={event.eventId === selected.eventId}
            >
              <span>
                <b>#{event.vaultSequence}</b>
                <small>{event.eventId} · {event.streamId}</small>
                <small>{event.observationSource}</small>
              </span>
              <StatusBadge state={event.vaultPersistenceStatus} />
            </button>
          ))}
        </article>
        <article className="panel detail">
          <p className="eyebrow">Selected event metadata <ModeTag mode={source.mode} /></p>
          <h2 className="mono">{selected.eventId}</h2>
          <dl>
            <div><dt>Source ID</dt><dd className="mono">{selected.sourceId}</dd></div>
            <div><dt>Source-local vault sequence</dt><dd>#{selected.vaultSequence}</dd></div>
            <div><dt>Stream</dt><dd>{selected.streamId}</dd></div>
            <div><dt>Observation source</dt><dd>{selected.observationSource}</dd></div>
            <div><dt>File identity (location only)</dt><dd className="mono">{selected.fileIdentity}</dd></div>
            <div><dt>Byte offset (location only)</dt><dd>{selected.byteOffset}</dd></div>
            <div><dt>Observed at</dt><dd>{formatTime(selected.observedAt)}</dd></div>
            <div><dt>Vault received at</dt><dd>{formatTime(selected.vaultReceivedAt)}</dd></div>
            <div><dt>Raw event length</dt><dd>{selected.rawEventLength} bytes</dd></div>
            <div><dt>Vault persistence</dt><dd><StatusBadge state={selected.vaultPersistenceStatus} /></dd></div>
            <div><dt>Correlation</dt><dd>{selected.correlationStatus}</dd></div>
          </dl>
          {source.mode === 'demo' && selected.demo && (
            <div className="fixture-evidence">
              <p className="eyebrow">DEMO-ONLY fixture detail</p>
              <p className="mono">Payload hash: {selected.demo.payloadHash ?? 'Not supplied'}</p>
              <label>
                Simulated raw-event preview; not returned by metadata
                <textarea readOnly value={selected.demo.rawPreview ?? 'No demo preview supplied.'} />
              </label>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}

function Recovery({ source }: { source: DemoSource }) {
  const gaps = source.adapter.getCollectionGaps();
  const affectedEvent = source.adapter.getEvents().find((event) => event.demo?.hostComparison);
  return (
    <section className="page">
      <PageHeading
        mode={source.mode}
        kicker="Recovery & continuity"
        title="Preservation after host change"
        description="A collection gap is separate from persistence and does not establish tampering."
        state="disconnected"
      />
      {gaps.length === 0 ? (
        <StatePanel state="empty" title="No collection gaps">No gap fixture is available.</StatePanel>
      ) : (
        <div className="two-col">
          <article className="panel recovery-card">
            <p className="eyebrow">Affected demo event</p>
            <h2>{affectedEvent?.eventId ?? 'No related event metadata'}</h2>
            <p>A host comparison difference is shown only as a demo scenario, not as an Auditor result.</p>
            <StatusDimension
              label="Vault persistence"
              state={affectedEvent?.vaultPersistenceStatus ?? 'PENDING'}
            />
            <dl>
              <div><dt>Source-local sequence</dt><dd>{affectedEvent?.vaultSequence ?? 'Not supplied'}</dd></div>
              <div><dt>Collection meaning</dt><dd>Does not prove what happened before collection</dd></div>
            </dl>
          </article>
          <article className="panel boundary">
            <p className="eyebrow">Collection gap</p>
            <h2><StatusBadge state={gaps[0].status} /></h2>
            <p>{gaps[0].sourceId} · {gaps[0].streamId}</p>
            <p>{formatTime(gaps[0].windowStart)} to {formatTime(gaps[0].windowEnd)}</p>
            <p>A gap indicates an unobserved interval; it does not prove which events occurred.</p>
          </article>
        </div>
      )}
    </section>
  );
}

function Checkpoints({ source }: { source: DemoSource }) {
  const checkpoints = source.adapter.getCheckpoints();
  return (
    <section className="page">
      <PageHeading
        mode={source.mode}
        kicker="Blockchain commitments"
        title="Checkpoint status"
        description="Checkpoint metadata does not contain original raw logs. Demo values are not live chain observations."
        state={checkpoints[0]?.independentVerificationStatus ?? 'empty'}
      />
      <article className="panel">
        <div className="callout">
          <b>Quai Orchard Cyprus-1 · Chain ID 15000</b>
          <span>
            ANCHORED_SERVER_REPORTED is not independent verification. RPC_VERIFIED applies
            only to an independently checked public-chain commitment.
          </span>
        </div>
        {checkpoints.length === 0 ? (
          <StatePanel state="empty" title="No checkpoint metadata">No checkpoint fixture is available.</StatePanel>
        ) : (
          <div className="checkpoint-list">
            {checkpoints.map((checkpoint) => (
              <article className="checkpoint" key={checkpoint.id}>
                <div>
                  <p className="eyebrow">{checkpoint.id} <ModeTag mode={source.mode} /></p>
                  <h2>{checkpoint.sourceId} · {checkpoint.sequenceRange}</h2>
                  <p className="mono">Root {checkpoint.merkleRoot}</p>
                  <small>Created at {formatTime(checkpoint.createdAt)}</small>
                </div>
                <div className="checkpoint-status">
                  <StatusDimension label="Vault persistence" state={checkpoint.vaultPersistenceStatus} />
                  <StatusDimension label="Local Hardhat anchoring" state={checkpoint.localAnchorStatus} />
                  <StatusDimension label="Public Quai anchoring" state={checkpoint.publicAnchorStatus} />
                  <StatusDimension label="Independent verification" state={checkpoint.independentVerificationStatus} />
                  <p className="mono">{checkpoint.transactionHash ?? 'No transaction hash supplied'}</p>
                  <small>{checkpoint.blockReference ?? 'No block reference supplied'}</small>
                </div>
              </article>
            ))}
          </div>
        )}
      </article>
    </section>
  );
}

function View({
  activeView,
  source,
  onNavigate,
}: {
  activeView: ViewId;
  source: DemoSource;
  onNavigate: (view: ViewId) => void;
}) {
  if (activeView === 'live-feed') return <LiveFeed source={source} />;
  if (activeView === 'verification') return <Verification source={source} />;
  if (activeView === 'explorer') return <Explorer source={source} />;
  if (activeView === 'recovery') return <Recovery source={source} />;
  if (activeView === 'checkpoints') return <Checkpoints source={source} />;
  return <Overview source={source} onNavigate={onNavigate} />;
}

export default function App({
  dataSource: suppliedSource,
}: {
  dataSource?: DashboardDataSource;
} = {}) {
  const [defaultSource] = useState(createDashboardDataSource);
  const dataSource = suppliedSource ?? defaultSource;
  const [activeView, setActiveView] = useState<ViewId>('overview');
  const isDemo = dataSource.mode === 'demo';

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span>TT</span>
          <div><b>TRUSTTRACE</b><small>evidence console</small></div>
        </div>
        <Navigation activeView={activeView} onNavigate={setActiveView} />
        <div className="sidebar-footer">
          <ModeTag mode={dataSource.mode} />
          <p>{isDemo
            ? 'Fixture data only. No API, WebSocket, or RPC connection.'
            : 'Read-only Vault REST data.'}</p>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span className="source-select">All sources</span>
          <div className="topbar-status">
            <span className="pulse" aria-hidden="true" />
            {isDemo ? 'Demo fixtures · offline' : 'Vault REST'}
            <ModeTag mode={dataSource.mode} />
          </div>
        </header>
        {dataSource.mode === 'live'
          ? <LiveDashboard adapter={dataSource.adapter} view={activeView} />
          : <View activeView={activeView} source={dataSource} onNavigate={setActiveView} />}
      </main>
    </div>
  );
}
