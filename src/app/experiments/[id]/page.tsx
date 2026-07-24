'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useMemo, useState } from 'react';
import {
  MODELS,
  SCORING_CATEGORIES,
  TEMPERATURES,
  THINKING_LEVELS,
  type BenchmarkJob,
  type BenchmarkModel,
  type BenchmarkTemperature,
  type EvidenceRecord,
  type ExperimentManifest,
  type ExperimentSummary,
  type JobAttempt,
  type JobStatus,
  type ManualScore,
  type ThinkingLevel,
} from '@/types';
import { finalAttemptMap, manualScoreTotal } from '@/lib/summary';

interface ExperimentData {
  manifest: ExperimentManifest;
  jobs: BenchmarkJob[];
  attempts: JobAttempt[];
  evidence: EvidenceRecord[];
  scores: ManualScore[];
  summary: ExperimentSummary;
  runtime: { running: boolean; paused: boolean; stopRequested: boolean; activeWorkers: number } | null;
}

type FilterState = {
  model: 'all' | BenchmarkModel;
  temperature: 'all' | `${BenchmarkTemperature}`;
  thinking: 'all' | ThinkingLevel;
  status: 'all' | JobStatus;
  validation: 'all' | 'schema-valid' | 'json-invalid' | 'schema-invalid' | 'provider-failed';
  trial: 'all' | string;
};

const INITIAL_FILTERS: FilterState = {
  model: 'all', temperature: 'all', thinking: 'all', status: 'all', validation: 'all', trial: 'all',
};

export default function ExperimentRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<ExperimentData | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [retrySelection, setRetrySelection] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/experiments/${id}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Failed to load experiment');
      setData(payload);
      setActionError(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to refresh experiment');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const active = data?.manifest.status === 'running' || data?.manifest.status === 'paused';
    const interval = window.setInterval(() => void refresh(), active ? 1500 : 5000);
    return () => window.clearInterval(interval);
  }, [data?.manifest.status, refresh]);

  const finalAttempts = useMemo(() => finalAttemptMap(data?.attempts ?? []), [data?.attempts]);
  const selectedJob = data?.jobs.find((job) => job.id === selectedJobId) ?? null;
  const selectedAttempts = useMemo(
    () => (data?.attempts ?? []).filter((attempt) => attempt.jobId === selectedJobId).sort((a, b) => b.attempt - a.attempt),
    [data?.attempts, selectedJobId]
  );
  const selectedFinalAttempt = selectedAttempts[0] ?? null;
  const selectedScore = selectedFinalAttempt
    ? data?.scores.find((score) => score.jobId === selectedFinalAttempt.jobId && score.attempt === selectedFinalAttempt.attempt) ?? null
    : null;

  const filteredJobs = useMemo(() => {
    if (!data) return [];
    return data.jobs.filter((job) => {
      const attempt = finalAttempts.get(job.id);
      if (filters.model !== 'all' && job.model !== filters.model) return false;
      if (filters.temperature !== 'all' && String(job.temperature) !== filters.temperature) return false;
      if (filters.thinking !== 'all' && job.thinkingLevel !== filters.thinking) return false;
      if (filters.status !== 'all' && job.status !== filters.status) return false;
      if (filters.trial !== 'all' && String(job.trial) !== filters.trial) return false;
      if (filters.validation === 'schema-valid' && !attempt?.schemaValid) return false;
      if (filters.validation === 'json-invalid' && !(job.status === 'succeeded' && attempt && !attempt.jsonParseValid)) return false;
      if (filters.validation === 'schema-invalid' && !(job.status === 'succeeded' && attempt?.jsonParseValid && !attempt.schemaValid)) return false;
      if (filters.validation === 'provider-failed' && job.status !== 'failed') return false;
      return true;
    });
  }, [data, filters, finalAttempts]);

  async function action(path: string, body?: unknown) {
    setActionError(null);
    setActionMessage(null);
    try {
      const response = await fetch(`/api/experiments/${id}/${path}`, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `Action ${path} failed`);
      setActionMessage(path === 'retry' ? `${payload.requeued ?? 0} transient failures requeued.` : 'Action accepted.');
      if (path === 'retry') setRetrySelection(new Set());
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Action failed');
    }
  }

  async function saveScore(score: ManualScore) {
    setActionError(null);
    const response = await fetch(`/api/experiments/${id}/scores`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(score),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? 'Failed to save score');
    setActionMessage('Manual score saved.');
    await refresh();
  }

  async function reviewEvidence(filename: string, decision: 'approved' | 'needs_revision' | 'rejected') {
    await action('evidence-review', { filename, decision });
  }

  if (loading) return <main className="app-shell"><div className="loading-state">Loading experiment…</div></main>;
  if (!data) return <main className="app-shell"><div className="alert error">{actionError ?? 'Experiment not found.'}</div><Link href="/">Return home</Link></main>;

  const { manifest, jobs, evidence, summary } = data;
  const active = data.runtime?.running ?? manifest.status === 'running';
  const intentionallyPaused = Boolean(data.runtime?.running && data.runtime.paused);
  const canStart = !active && !intentionallyPaused && jobs.some((job) => job.status === 'queued');
  const retryableIds = new Set(
    jobs.filter((job) => job.status === 'failed' && isAttemptRetryable(finalAttempts.get(job.id))).map((job) => job.id)
  );

  return (
    <main className="app-shell wide">
      <header className="run-header">
        <div>
          <Link className="back-link" href="/">← New experiment</Link>
          <div className="eyebrow">{manifest.image.originalFilename}</div>
          <h1>{manifest.experimentId}</h1>
          <p className="lede">One image · {manifest.trials} trial{manifest.trials === 1 ? '' : 's'} · {manifest.totalCalls} locked calls</p>
        </div>
        <div className="run-status-stack">
          <span className={`status-pill ${manifest.status}`}>{manifest.status}</span>
          <small>{data.runtime?.activeWorkers ?? 0} active workers</small>
        </div>
      </header>

      {(actionError || manifest.lastError) && <div className="alert error" role="alert">{actionError ?? manifest.lastError}</div>}
      {actionMessage && <div className="alert success" role="status">{actionMessage}</div>}

      <section className="run-overview-grid">
        <div className="source-card">
          <img src={`/api/experiments/${id}/source`} alt={`Source: ${manifest.image.originalFilename}`} />
          <div className="source-meta">
            <strong>{manifest.image.originalFilename}</strong>
            <span>{manifest.image.detectedMimeType} · {(manifest.image.byteLength / 1024).toFixed(1)} KiB</span>
            <code>{manifest.image.sha256.slice(0, 16)}…</code>
          </div>
        </div>
        <div className="control-panel panel">
          <div className="section-heading compact"><div><h2>Run controls</h2></div><p>Four calls per wave; all use this source image.</p></div>
          <div className="control-row">
            <button className="primary-action compact-button" disabled={!canStart || active} onClick={() => void action('start')}>Start calls</button>
            <button className="secondary-button" disabled={!active || data.runtime?.paused} onClick={() => void action('pause', { action: 'pause' })}>Pause</button>
            <button className="secondary-button" disabled={!intentionallyPaused} onClick={() => void action('pause', { action: 'resume' })}>Resume</button>
            <button className="danger-button" disabled={!active && manifest.status !== 'paused'} onClick={() => void action('stop')}>Stop remaining</button>
          </div>
          <div className="export-row">
            <a href={`/api/experiments/${id}/export?format=json`}>Export JSON</a>
            <a href={`/api/experiments/${id}/export?format=jsonl`}>Export JSONL</a>
            <a href={`/api/experiments/${id}/export?format=csv`}>Export CSV</a>
          </div>
          <div className="locked-mini-grid">
            <div><span>Top-P</span><strong>{manifest.locked.topP}</strong></div>
            <div><span>Structured</span><strong>ON</strong></div>
            <div><span>Transport</span><strong>Interactions</strong></div>
            <div><span>SDK</span><strong>{manifest.sdkVersion}</strong></div>
          </div>
        </div>
      </section>

      <section className="metric-grid status-grid">
        <StatusMetric label="Queued" value={summary.statusCounts.queued} />
        <StatusMetric label="Running" value={summary.statusCounts.running} />
        <StatusMetric label="Provider passed" value={summary.statusCounts.succeeded} tone="good" />
        <StatusMetric label="Provider failed" value={summary.statusCounts.failed} tone="bad" />
        <StatusMetric label="JSON invalid" value={summary.jsonInvalid} tone={summary.jsonInvalid ? 'warn' : 'neutral'} />
        <StatusMetric label="Schema invalid" value={summary.schemaInvalid} tone={summary.schemaInvalid ? 'warn' : 'neutral'} />
      </section>

      <section className="panel">
        <div className="section-heading compact"><div><h2>Configuration comparison</h2></div><p>Rows are temperature × thinking; each model cell shows schema validity, average score, and latency.</p></div>
        <div className="table-wrap">
          <table className="comparison-table">
            <thead><tr><th>Temperature</th><th>Thinking</th>{MODELS.map((model) => <th key={model}>{model}</th>)}</tr></thead>
            <tbody>
              {TEMPERATURES.flatMap((temperature) => THINKING_LEVELS.map((thinking) => (
                <tr key={`${temperature}-${thinking}`}>
                  <td><strong>{temperature}</strong></td><td>{thinking}</td>
                  {MODELS.map((model) => {
                    const aggregate = summary.aggregates.find((item) => item.model === model && item.temperature === temperature && item.thinkingLevel === thinking);
                    return <td key={model}>{aggregate ? <AggregateCell aggregate={aggregate} /> : <span className="muted">No data</span>}</td>;
                  })}
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading compact"><div><h2>Calls</h2></div><p>{filteredJobs.length} of {jobs.length} jobs shown.</p></div>
        <div className="filter-grid">
          <FilterSelect label="Model" value={filters.model} onChange={(value) => setFilters({ ...filters, model: value as FilterState['model'] })} options={['all', ...MODELS]} />
          <FilterSelect label="Temperature" value={filters.temperature} onChange={(value) => setFilters({ ...filters, temperature: value as FilterState['temperature'] })} options={['all', ...TEMPERATURES.map(String)]} />
          <FilterSelect label="Thinking" value={filters.thinking} onChange={(value) => setFilters({ ...filters, thinking: value as FilterState['thinking'] })} options={['all', ...THINKING_LEVELS]} />
          <FilterSelect label="Status" value={filters.status} onChange={(value) => setFilters({ ...filters, status: value as FilterState['status'] })} options={['all', 'queued', 'running', 'succeeded', 'failed', 'stopped']} />
          <FilterSelect label="Validation" value={filters.validation} onChange={(value) => setFilters({ ...filters, validation: value as FilterState['validation'] })} options={['all', 'schema-valid', 'json-invalid', 'schema-invalid', 'provider-failed']} />
          <FilterSelect label="Trial" value={filters.trial} onChange={(value) => setFilters({ ...filters, trial: value })} options={['all', ...Array.from({ length: manifest.trials }, (_, index) => String(index + 1))]} />
        </div>
        <div className="table-wrap">
          <table className="jobs-table">
            <thead><tr><th>Retry</th><th>Model</th><th>Temp</th><th>Thinking</th><th>Trial</th><th>Wave</th><th>Status</th><th>Validation</th><th>Latency</th><th></th></tr></thead>
            <tbody>
              {filteredJobs.map((job) => {
                const attempt = finalAttempts.get(job.id);
                const retryable = retryableIds.has(job.id);
                return (
                  <tr key={job.id} className={selectedJobId === job.id ? 'selected-row' : ''}>
                    <td><input type="checkbox" aria-label={`Retry ${job.id}`} disabled={!retryable} checked={retrySelection.has(job.id)} onChange={(event) => setRetrySelection(toggleSet(retrySelection, job.id, event.target.checked))} /></td>
                    <td className="model-cell">{job.model}</td><td>{job.temperature}</td><td>{job.thinkingLevel}</td><td>{job.trial}</td><td>{job.waveNumber}</td>
                    <td><span className={`status-pill ${job.status}`}>{job.status}</span></td>
                    <td><ValidationBadge job={job} attempt={attempt} /></td>
                    <td>{attempt?.latencyMs != null ? `${(attempt.latencyMs / 1000).toFixed(1)}s` : '—'}</td>
                    <td><button className="text-button" onClick={() => setSelectedJobId(job.id)}>Review</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="retry-bar">
          <span>{retrySelection.size} retryable failure{retrySelection.size === 1 ? '' : 's'} selected</span>
          <button className="secondary-button" disabled={retrySelection.size === 0} onClick={() => void action('retry', { jobIds: [...retrySelection] })}>Retry selected</button>
        </div>
      </section>

      {selectedJob && (
        <section className="panel detail-panel">
          <div className="section-heading compact"><div><h2>Response review</h2><code>{selectedJob.id}</code></div><button className="text-button" onClick={() => setSelectedJobId(null)}>Close</button></div>
          <div className="detail-facts">
            <span>Model <strong>{selectedJob.model}</strong></span><span>Temperature <strong>{selectedJob.temperature}</strong></span><span>Thinking <strong>{selectedJob.thinkingLevel}</strong></span><span>Trial <strong>{selectedJob.trial}</strong></span>
          </div>
          {selectedAttempts.length === 0 ? <div className="empty-state">No attempt has completed for this job.</div> : selectedAttempts.map((attempt) => (
            <article key={attempt.attempt} className="attempt-card">
              <div className="attempt-header"><div><strong>Attempt {attempt.attempt}</strong><span>{attempt.latencyMs != null ? `${attempt.latencyMs} ms` : 'No latency'} · HTTP {attempt.providerStatus ?? '—'}</span></div><div><ValidationBadge job={selectedJob} attempt={attempt} /></div></div>
              {attempt.providerErrorMessage && <div className="alert error">{attempt.providerErrorCode ? `${attempt.providerErrorCode}: ` : ''}{attempt.providerErrorMessage}</div>}
              {attempt.schemaIssues.length > 0 && <div className="schema-issues"><strong>Validation issues</strong><ul>{attempt.schemaIssues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></div>}
              <div className="response-grid">
                <div><h3>Raw output</h3><pre>{attempt.rawOutputText ?? 'No model output.'}</pre></div>
                <div><h3>Parsed JSON</h3><pre>{attempt.parsedJson != null ? JSON.stringify(attempt.parsedJson, null, 2) : 'Not parseable.'}</pre></div>
              </div>
              {attempt.usage != null && <details><summary>Usage metadata</summary><pre>{JSON.stringify(attempt.usage, null, 2)}</pre></details>}
            </article>
          ))}
          {selectedFinalAttempt && <ScoreEditor key={`${selectedFinalAttempt.jobId}-${selectedFinalAttempt.attempt}-${selectedScore?.updatedAt ?? 'new'}`} attempt={selectedFinalAttempt} existing={selectedScore} onSave={saveScore} />}
        </section>
      )}

      <section className="panel">
        <div className="section-heading compact"><div><h2>Evidence for this image</h2></div><p>Machine-verified pixel facts remain distinct from visual facts pending owner sign-off.</p></div>
        {evidence.length === 0 ? <div className="empty-state">No matching evidence record. The filename must exactly match <strong>{manifest.image.originalFilename}</strong>.</div> : evidence.map((record) => (
          <article className="evidence-card" key={record.filename}>
            <div className="evidence-header"><div><strong>{record.role ?? record.filename}</strong><span>{record.ownerSignOffState ?? 'unknown source state'}</span></div><span className={`status-pill ${record.reviewDecision ?? 'unreviewed'}`}>{record.reviewDecision ?? 'unreviewed'}</span></div>
            <div className="evidence-grid">
              <EvidenceBlock title="Pixel facts" value={record.pixelFacts} />
              <EvidenceBlock title="Visual facts" value={record.visualFacts} />
              <EvidenceBlock title="Quarantine target" value={record.quarantineRequirements} />
              <EvidenceBlock title="Discrimination target" value={record.discriminationTarget} />
            </div>
            <div className="control-row"><button className="secondary-button" onClick={() => void reviewEvidence(record.filename, 'approved')}>Approve</button><button className="secondary-button" onClick={() => void reviewEvidence(record.filename, 'needs_revision')}>Needs revision</button><button className="danger-button" onClick={() => void reviewEvidence(record.filename, 'rejected')}>Reject</button></div>
          </article>
        ))}
      </section>
    </main>
  );
}

function StatusMetric({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'neutral' | 'good' | 'bad' | 'warn' }) {
  return <div className={`metric-card ${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

function AggregateCell({ aggregate }: { aggregate: ExperimentSummary['aggregates'][number] }) {
  const schemaLabel = aggregate.completedTrials === 0
    ? 'Pending'
    : `${Math.round(aggregate.schemaValidRate * 100)}% schema`;
  return <div className="aggregate-cell"><strong>{schemaLabel}</strong><span>{aggregate.averageManualScore == null ? 'Not scored' : `${aggregate.averageManualScore}/100`}</span><small>{aggregate.averageLatencyMs == null ? 'No latency' : `${(aggregate.averageLatencyMs / 1000).toFixed(1)}s avg`} · {aggregate.providerSucceeded}/{aggregate.completedTrials} completed · {aggregate.totalTrials} planned</small></div>;
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: readonly string[] }) {
  return <label><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option} value={option}>{option === 'all' ? 'All' : option}</option>)}</select></label>;
}

function ValidationBadge({ job, attempt }: { job: BenchmarkJob; attempt?: JobAttempt }) {
  if (job.status === 'failed') return <span className="validation-badge bad">provider failed</span>;
  if (!attempt) return <span className="validation-badge neutral">pending</span>;
  if (!attempt.jsonParseValid) return <span className="validation-badge warn">JSON invalid</span>;
  if (!attempt.schemaValid) return <span className="validation-badge warn">schema invalid</span>;
  return <span className="validation-badge good">schema valid</span>;
}

function ScoreEditor({ attempt, existing, onSave }: { attempt: JobAttempt; existing: ManualScore | null; onSave: (score: ManualScore) => Promise<void> }) {
  const [scores, setScores] = useState<ManualScore['scores']>(existing?.scores ?? {});
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = manualScoreTotal({ jobId: attempt.jobId, attempt: attempt.attempt, scores, notes, updatedAt: '' });

  async function submit() {
    setSaving(true); setError(null);
    try { await onSave({ jobId: attempt.jobId, attempt: attempt.attempt, scores, notes, updatedAt: new Date().toISOString() }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Failed to save score'); }
    finally { setSaving(false); }
  }

  return <div className="score-panel"><div className="score-heading"><div><h3>Fixed 100-point review</h3><span>Score each defect once under its primary category.</span></div><strong>{total == null ? 'Incomplete' : `${total}/100`}</strong></div><div className="score-grid">{SCORING_CATEGORIES.map((category) => <label key={category.key}><span>{category.label}<small> / {category.max}</small></span><input type="number" min={0} max={category.max} step={1} value={scores[category.key] ?? ''} onChange={(event) => setScores({ ...scores, [category.key]: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>)}</div><label className="field-label">Review notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Specific defects, evidence references, and uncertainty notes…" /></label>{error && <div className="alert error">{error}</div>}<button className="primary-action compact-button" disabled={saving} onClick={() => void submit()}>{saving ? 'Saving…' : 'Save review'}</button></div>;
}

function EvidenceBlock({ title, value }: { title: string; value: unknown }) {
  return <div><h3>{title}</h3><pre>{value == null ? 'Not supplied' : typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</pre></div>;
}

function toggleSet(current: Set<string>, value: string, enabled: boolean): Set<string> {
  const next = new Set(current); if (enabled) next.add(value); else next.delete(value); return next;
}

function isAttemptRetryable(attempt: JobAttempt | undefined): boolean {
  if (!attempt) return false;
  return [429, 500, 502, 503, 504].includes(attempt.providerStatus ?? -1) || ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'network_interruption', 'connection_reset', 'request_timeout'].includes(attempt.providerErrorCode ?? '');
}
