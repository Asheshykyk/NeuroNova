import { useState } from 'react';
import { mockDashboardAdapter } from './data/mockAdapter';
import { Navigation } from './components/Navigation';
import { StatusBadge } from './components/StatusBadge';
import type { EvidenceEvent, ViewId } from './types';

const adapter = mockDashboardAdapter;

function formatTime(value?: string) {
  return value ? new Date(value).toLocaleString('en-GB', { timeZone: 'UTC', hour12: false }) + ' UTC' : 'Not supplied';
}

function DemoTag() {
  return <span className="demo-tag">DEMO DATA</span>;
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <article className="metric-card"><p>{label}</p><strong>{value}</strong><small>{note}</small><DemoTag /></article>;
}

function EventTable({ events, onSelect }: { events: EvidenceEvent[]; onSelect?: (event: EvidenceEvent) => void }) {
  return <div className="table-wrap"><table><thead><tr><th>Sequence</th><th>Source / stream</th><th>Vault receipt</th><th>Evidence</th><th>State</th></tr></thead><tbody>
    {events.map((event) => <tr key={event.id} onClick={() => onSelect?.(event)} className={onSelect ? 'selectable' : ''}>
      <td><b>#{event.vaultSequence}</b><small>{event.id}</small></td><td>{event.sourceId}<small>{event.streamId} · {event.correlationStatus}</small></td><td>{formatTime(event.vaultReceivedAt)}</td><td className="mono">{event.payloadHash}</td><td><StatusBadge state={event.evidenceState} /></td>
    </tr>)}
  </tbody></table></div>;
}

function Overview({ onNavigate }: { onNavigate: (view: ViewId) => void }) {
  const events = adapter.getEvents();
  return <section className="page"><header className="page-heading"><div><p className="eyebrow">Operational picture <DemoTag /></p><h1>Security evidence at a glance</h1><p>Mock data only. Backend, WebSocket, and independent RPC verification are not connected.</p></div><StatusBadge state="disconnected" /></header>
    <div className="metric-grid"><Metric label="Vault observations" value="186" note="Demo sequence high-water mark" /><Metric label="Anchored batches" value="1" note="API-reported checkpoint" /><Metric label="Open integrity findings" value="1" note="Host comparison mismatch" /><Metric label="Collection gaps" value="1" note="Demo heartbeat scenario" /></div>
    <div className="two-col"><article className="panel"><div className="panel-heading"><div><p className="eyebrow">Latest evidence</p><h2>Vault-received observations</h2></div><button className="text-button" onClick={() => onNavigate('live-feed')}>View feed</button></div><EventTable events={events.slice(0, 2)} /></article>
    <article className="panel boundary"><p className="eyebrow">Evidence boundary</p><h2>What this view can say</h2><p>It presents demo observations. A checkpoint reference is not independent verification until a future auditor performs a direct RPC lookup.</p><button className="text-button" onClick={() => onNavigate('verification')}>Inspect witnesses</button></article></div>
  </section>;
}

function LiveFeed() {
  return <section className="page"><header className="page-heading"><div><p className="eyebrow">Live transport <DemoTag /></p><h1>Live evidence feed</h1><p>Feed is disconnected because this standalone dashboard has no WebSocket integration.</p></div><StatusBadge state="disconnected" /></header><article className="panel"><div className="callout"><b>Stale-safe display</b><span>Rendered events are static mock records. Receipt and anchor claims require the future vault API contract.</span></div><EventTable events={adapter.getEvents()} /></article></section>;
}

function Verification() {
  return <section className="page"><header className="page-heading"><div><p className="eyebrow">Witness comparison <DemoTag /></p><h1>Host / Vault / Blockchain</h1><p>The blockchain card is deliberately not marked independently verified.</p></div><StatusBadge state="tampered" /></header><div className="witness-grid">{adapter.getVerification().map((item) => <article className="witness-card" key={item.witness}><div className="panel-heading"><h2>{item.witness}</h2><StatusBadge state={item.state} /></div><p>{item.summary}</p><dl>{item.details.map((detail) => <div key={detail.label}><dt>{detail.label}</dt><dd className="mono">{detail.value ?? 'Not supplied'}</dd></div>)}</dl><DemoTag /></article>)}</div><article className="panel conclusion"><p className="eyebrow">Current conclusion</p><h2>Host mismatch detected in demo data</h2><p>Preserved evidence and checkpoint material are shown for investigation. No direct RPC query has been performed, so this dashboard makes no independent blockchain-verification claim.</p></article></section>;
}

function Explorer() {
  const [selected, setSelected] = useState(adapter.getEvents()[1]);
  return <section className="page"><header className="page-heading"><div><p className="eyebrow">Evidence inspection <DemoTag /></p><h1>Evidence explorer</h1><p>Raw content preview is supplied only by mock data and is not a vault read.</p></div><StatusBadge state={selected.evidenceState} /></header><div className="explorer-grid"><article className="panel"><p className="eyebrow">Available records</p>{adapter.getEvents().map((event) => <button className={`record ${event.id === selected.id ? 'selected' : ''}`} onClick={() => setSelected(event)} key={event.id}><span><b>#{event.vaultSequence}</b><small>{event.sourceId} · {event.streamId}</small></span><StatusBadge state={event.evidenceState} /></button>)}</article><article className="panel detail"><p className="eyebrow">Selected record <DemoTag /></p><h2>{selected.id}</h2><dl><div><dt>Vault sequence</dt><dd>#{selected.vaultSequence}</dd></div><div><dt>Evidence hash</dt><dd className="mono">{selected.payloadHash}</dd></div><div><dt>Host timestamp</dt><dd>{formatTime(selected.hostTimestamp)}</dd></div><div><dt>Checkpoint</dt><dd className="mono">{selected.checkpointId ?? 'Not batched'}</dd></div></dl><label>Mock raw-event preview<textarea readOnly value={selected.rawPreview ?? 'No raw preview supplied by this record.'} /></label></article></div></section>;
}

function Recovery() {
  return <section className="page"><header className="page-heading"><div><p className="eyebrow">Recovery & continuity <DemoTag /></p><h1>Preservation after host change</h1><p>Recovery is possible only for records already preserved by the vault.</p></div><StatusBadge state="stale" /></header><div className="two-col"><article className="panel recovery-card"><p className="eyebrow">Affected record</p><h2>Sequence #185</h2><StatusBadge state="tampered" /><p>Mock host comparison reports a difference. The dashboard retains a separate vault-evidence panel for investigator review.</p><dl><div><dt>Vault evidence</dt><dd>Demo record available</dd></div><div><dt>Collection meaning</dt><dd>Does not prove what happened before collection</dd></div></dl></article><article className="panel boundary"><p className="eyebrow">Heartbeat gap</p><h2>Observability interruption</h2><p>Mock agent liveness data is stale. This indicates an unobserved interval, not a claim about which events occurred in it.</p><StatusBadge state="stale" /></article></div></section>;
}

function Checkpoints() {
  return <section className="page"><header className="page-heading"><div><p className="eyebrow">Blockchain commitments <DemoTag /></p><h1>Checkpoint status</h1><p>On-chain raw logs are never displayed because checkpoints carry commitment metadata only.</p></div><StatusBadge state="anchored-server-reported" /></header><article className="panel"><div className="callout"><b>Independent verification pending</b><span>Transaction and block fields are mock API-reported values. Direct RPC validation is intentionally unavailable.</span></div><div className="checkpoint-list">{adapter.getCheckpoints().map((checkpoint) => <article className="checkpoint" key={checkpoint.id}><div><p className="eyebrow">{checkpoint.id} <DemoTag /></p><h2>{checkpoint.sourceId} · {checkpoint.sequenceRange}</h2><p className="mono">Root {checkpoint.merkleRoot}</p></div><div><StatusBadge state={checkpoint.state} /><p className="mono">{checkpoint.transactionHash ?? 'No transaction hash supplied'}</p><small>{checkpoint.blockReference ?? 'Awaiting anchor'}</small></div></article>)}</div></article></section>;
}

function View({ activeView, onNavigate }: { activeView: ViewId; onNavigate: (view: ViewId) => void }) {
  if (activeView === 'live-feed') return <LiveFeed />;
  if (activeView === 'verification') return <Verification />;
  if (activeView === 'explorer') return <Explorer />;
  if (activeView === 'recovery') return <Recovery />;
  if (activeView === 'checkpoints') return <Checkpoints />;
  return <Overview onNavigate={onNavigate} />;
}

export default function App() {
  const [activeView, setActiveView] = useState<ViewId>('overview');
  return <div className="app-shell"><aside className="sidebar"><div className="brand"><span>TT</span><div><b>TRUSTTRACE</b><small>evidence console</small></div></div><Navigation activeView={activeView} onNavigate={setActiveView} /><div className="sidebar-footer"><DemoTag /><p>Mock adapter active. No API, WebSocket, or RPC connection.</p></div></aside><main><header className="topbar"><button className="source-select" aria-label="Selected source">host-lab-01 <span>⌄</span></button><div className="topbar-status"><span className="pulse" aria-hidden="true" /> Demo mode · offline</div></header><View activeView={activeView} onNavigate={setActiveView} /></main></div>;
}
