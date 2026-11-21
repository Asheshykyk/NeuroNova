import { useEffect, useRef, useState, type FormEvent } from 'react';
import { StatusBadge } from './StatusBadge';
import { ApiTimeoutError } from '../data/apiTransport';
import {
  requestRestVerification,
  type AuditorRestResult,
  type AuditorStage,
  type AuditorStatus,
} from '../data/verifierBridge';

const sourceIdPattern = /^0x[0-9a-f]{64}$/i;
const sequencePattern = /^[1-9]\d{0,19}$/;
const uint64Max = (1n << 64n) - 1n;

const stageLabels: Record<AuditorStage['stage'], string> = {
  'rest-fetch': 'Vault REST evidence fetch',
  'vault-signature': 'Vault EIP-712 signature',
  'commitment-matching': 'Commitment consistency',
  'raw-byte-validation': 'Raw event checks',
  'merkle-verification': 'Merkle inclusion',
  'direct-rpc': 'Tier 1 RPC',
  'public-checkpoint-verification': 'Tier 2 checkpoint',
};

function isValidIdentity(sourceId: string, sequence: string): boolean {
  return sourceIdPattern.test(sourceId)
    && sequencePattern.test(sequence)
    && BigInt(sequence) <= uint64Max;
}

function StageRow({
  label,
  status,
  reasonCode,
  message,
}: {
  label: string;
  status: AuditorStatus;
  reasonCode?: string;
  message: string;
}) {
  return (
    <article className="verification-stage">
      <div>
        <b>{label}</b>
        {reasonCode && <small className="mono">{reasonCode}</small>}
        <p>{message}</p>
      </div>
      <StatusBadge state={{ kind: 'auditor-cli', outcome: status }} />
    </article>
  );
}

function ResultView({ result }: { result: AuditorRestResult }) {
  const stages = new Map(result.tier1.stages.map((stage) => [stage.stage, stage]));
  const rawChecks = stages.get('raw-byte-validation')?.checks ?? [];
  const payloadCheck = rawChecks.find((check) => check.check === 'payload-sha256');
  const leafCheck = rawChecks.find((check) => check.check === 'canonical-leaf');
  const rawStage = stages.get('raw-byte-validation');

  return (
    <article className="panel auditor-result" aria-label="Independent Auditor result">
      <div className="auditor-verdict">
        <div>
          <p className="eyebrow">Independent Auditor · VAULT REST</p>
          <h2>Overall verdict</h2>
          <p>{result.message}</p>
          <p className="mono">Reason: {result.reasonCode ?? 'NONE'}</p>
          <p className="mono">{result.sourceId} · sequence {result.vaultSequence}</p>
          <p className="mono">Batch {result.batchId ?? 'Not supplied'}</p>
        </div>
        <div role="group" aria-label={`Overall Auditor status: ${result.status}`}>
          <StatusBadge state={{ kind: 'auditor-cli', outcome: result.status }} />
        </div>
      </div>
      <div className="verification-stages">
        {(['rest-fetch', 'vault-signature', 'commitment-matching'] as const).map((name) => {
          const stage = stages.get(name);
          return (
            <StageRow
              key={name}
              label={stageLabels[name]}
              status={stage?.status ?? 'UNVERIFIABLE'}
              reasonCode={stage?.reasonCode}
              message={stage?.message ?? 'No result was returned for this check.'}
            />
          );
        })}
        <StageRow
          label="Payload SHA-256"
          status={payloadCheck?.status ?? rawStage?.status ?? 'UNVERIFIABLE'}
          reasonCode={payloadCheck?.reasonCode ?? rawStage?.reasonCode}
          message={payloadCheck?.message ?? rawStage?.message ?? 'No result was returned for this check.'}
        />
        <StageRow
          label="Canonical leaf"
          status={leafCheck?.status ?? rawStage?.status ?? 'UNVERIFIABLE'}
          reasonCode={leafCheck?.reasonCode ?? rawStage?.reasonCode}
          message={leafCheck?.message ?? rawStage?.message ?? 'No result was returned for this check.'}
        />
        {(['merkle-verification', 'direct-rpc'] as const).map((name) => {
          const stage = stages.get(name);
          return (
            <StageRow
              key={name}
              label={stageLabels[name]}
              status={stage?.status ?? 'UNVERIFIABLE'}
              reasonCode={stage?.reasonCode}
              message={stage?.message ?? 'No result was returned for this check.'}
            />
          );
        })}
        <StageRow
          label={stageLabels['public-checkpoint-verification']}
          status={result.tier2.status}
          reasonCode={result.tier2.reasonCode}
          message={result.tier2.message}
        />
      </div>
      <p className="verification-scope-note">
        Tier 1 local batch checks and Tier 2 public checkpoint checks are reported separately.
        A server-reported anchor is not an independent RPC result.
      </p>
    </article>
  );
}

export function LiveVerification({
  initialSourceId,
  sourcesLoading,
  sourcesError,
}: {
  initialSourceId: string;
  sourcesLoading: boolean;
  sourcesError?: string;
}) {
  const [sourceId, setSourceId] = useState(initialSourceId);
  const [sequence, setSequence] = useState('1');
  const [state, setState] = useState<{
    loading: boolean;
    result?: AuditorRestResult;
    error?: string;
    inputError?: string;
  }>({ loading: false });
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!sourceId && initialSourceId) setSourceId(initialSourceId);
  }, [initialSourceId, sourceId]);

  useEffect(() => () => controller.current?.abort(), []);

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isValidIdentity(sourceId, sequence)) {
      setState((previous) => ({
        ...previous,
        loading: false,
        inputError: 'Enter a bytes32 source ID and positive decimal uint64 sequence.',
      }));
      return;
    }

    controller.current?.abort();
    const requestController = new AbortController();
    controller.current = requestController;
    setState({ loading: true });
    try {
      const result = await requestRestVerification({ sourceId, sequence }, requestController.signal);
      if (!requestController.signal.aborted) setState({ loading: false, result });
    } catch (error) {
      if (!requestController.signal.aborted) {
        setState({
          loading: false,
          error: error instanceof ApiTimeoutError
            ? 'Auditor verification request timed out; no verdict was produced.'
            : error instanceof Error && error.message
              ? error.message
              : 'Auditor verification request failed; no verdict was produced.',
        });
      }
    }
  }

  return (
    <section className="live-verification">
      <article className="panel verification-request">
        <p className="eyebrow"><span className="mode-tag pending-mode-tag">LIVE REST</span> Independent Auditor bridge</p>
        <h2>Verify evidence</h2>
        <p>The server fetches the event and runs the existing read-only Auditor with fixed deployment settings.</p>
        <form onSubmit={verify}>
          <label>
            Source ID
            <input
              aria-label="Verification source ID"
              autoComplete="off"
              maxLength={66}
              value={sourceId}
              onChange={(event) => setSourceId(event.target.value)}
            />
          </label>
          <label>
            Vault sequence
            <input
              aria-label="Verification sequence"
              autoComplete="off"
              inputMode="numeric"
              maxLength={20}
              value={sequence}
              onChange={(event) => setSequence(event.target.value)}
            />
          </label>
          <button type="submit" disabled={state.loading}>
            {state.loading ? 'Verifying…' : 'Verify evidence'}
          </button>
        </form>
        {sourcesLoading && <p role="status">Loading Vault sources…</p>}
        {sourcesError && <p role="alert">Source list unavailable: {sourcesError}</p>}
        {!sourcesLoading && !sourcesError && !initialSourceId && !sourceId
          && <p role="status">No Vault source is available; enter a source ID to verify an event.</p>}
        {state.inputError && <p role="alert">{state.inputError}</p>}
        {state.error && <p role="alert">{state.error}</p>}
        {state.loading && <p role="status">Auditor is checking this source-local event…</p>}
      </article>
      {state.result && <ResultView result={state.result} />}
    </section>
  );
}
