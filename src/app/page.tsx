'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CONCURRENCY, MAX_OUTPUT_TOKENS, MODELS, TEMPERATURES, THINKING_LEVELS, TOP_P, type ExperimentListItem } from '@/types';
import { DEFAULT_FLASH_THEME_SCHEMA_TEXT } from '@/lib/default-schema';

export default function CreateExperimentPage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState('');
  const [systemInstruction, setSystemInstruction] = useState('');
  const [responseSchema, setResponseSchema] = useState(DEFAULT_FLASH_THEME_SCHEMA_TEXT);
  const [trials, setTrials] = useState(1);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [recent, setRecent] = useState<ExperimentListItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const imagePreview = useMemo(() => (imageFile ? URL.createObjectURL(imageFile) : null), [imageFile]);
  useEffect(() => () => { if (imagePreview) URL.revokeObjectURL(imagePreview); }, [imagePreview]);

  useEffect(() => {
    fetch('/api/experiments')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('Failed to load recent runs'))))
      .then((data: { experiments: ExperimentListItem[] }) => setRecent(data.experiments.slice(0, 8)))
      .catch(() => undefined);
  }, []);

  const callCount = MODELS.length * TEMPERATURES.length * THINKING_LEVELS.length * trials;

  async function loadTextFile(file: File | undefined, setter: (value: string) => void) {
    if (!file) return;
    setter(await file.text());
  }

  async function handleCreate() {
    setError(null);
    if (!imageFile) return setError('Select one source image.');
    if (!prompt.trim()) return setError('Paste or load the FLASH-1 Theme Extraction prompt.');
    if (!systemInstruction.trim()) return setError('Paste or load the system instruction.');

    setBusy(true);
    try {
      const form = new FormData();
      form.set('image', imageFile);
      form.set('prompt', prompt);
      form.set('systemInstruction', systemInstruction);
      form.set('responseSchema', responseSchema);
      form.set('trials', String(trials));
      if (evidenceFile) form.set('evidence', evidenceFile);

      const response = await fetch('/api/experiments', { method: 'POST', body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Failed to create experiment');
      router.push(`/experiments/${data.experimentId}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unknown creation error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <div className="eyebrow">Standalone evaluation workspace</div>
          <h1>FLASH-1 Theme Benchmark</h1>
          <p className="lede">Run one fixed image through the exact 24-cell Gemini matrix. This repository is isolated from Artlock/TattooLock.</p>
        </div>
        <span className="status-pill safe">ARTLOCK UNTOUCHED</span>
      </header>

      <section className="metric-grid" aria-label="Locked benchmark settings">
        <div className="metric-card"><span>Models</span><strong>2</strong><small>{MODELS.join(' · ')}</small></div>
        <div className="metric-card"><span>Temperatures</span><strong>4</strong><small>{TEMPERATURES.join(' · ')}</small></div>
        <div className="metric-card"><span>Thinking</span><strong>3</strong><small>{THINKING_LEVELS.join(' · ')}</small></div>
        <div className="metric-card"><span>Calls / trial</span><strong>24</strong><small>Top-P {TOP_P} · {CONCURRENCY} workers</small></div>
      </section>

      <section className="panel form-panel">
        <div className="section-heading">
          <div><span className="step">01</span><h2>Lock the source</h2></div>
          <p>Every call in this experiment uses the exact same image bytes and detected MIME type.</p>
        </div>
        <div className="source-grid">
          <label className="file-drop">
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setImageFile(event.target.files?.[0] ?? null)} />
            {imagePreview ? <img src={imagePreview} alt="Selected source preview" /> : <div><strong>Select source image</strong><span>PNG, JPEG, or WebP · up to 20 MiB</span></div>}
          </label>
          <div className="stack">
            <label className="field-label" htmlFor="evidence">Evidence suite <span>optional</span></label>
            <input id="evidence" className="file-input" type="file" accept=".json,application/json" onChange={(event) => setEvidenceFile(event.target.files?.[0] ?? null)} />
            <p className="helper">Supports your aggregate <code>evidence-suite.json</code> with an <code>images</code> array and the legacy per-image evidence files.</p>
            <div className="file-facts">
              <div><span>Image</span><strong>{imageFile?.name ?? 'Not selected'}</strong></div>
              <div><span>Evidence</span><strong>{evidenceFile?.name ?? 'Not attached'}</strong></div>
            </div>
          </div>
        </div>
      </section>

      <section className="panel form-panel">
        <div className="section-heading">
          <div><span className="step">02</span><h2>Lock the contract</h2></div>
          <p>Prompt, system instruction, and JSON Schema are hashed when the experiment is created.</p>
        </div>

        <TextArtifactField label="Theme Extraction Prompt" value={prompt} onChange={setPrompt} accept=".txt,.md" placeholder="Paste the exact FLASH-1 prompt…" onFile={loadTextFile} />
        <TextArtifactField label="System Instruction" value={systemInstruction} onChange={setSystemInstruction} accept=".txt,.md" placeholder="Paste the exact system instruction…" onFile={loadTextFile} />
        <TextArtifactField label="Structured Output JSON Schema" value={responseSchema} onChange={setResponseSchema} accept=".json" placeholder="JSON Schema…" onFile={loadTextFile} mono />
      </section>

      <section className="panel form-panel">
        <div className="section-heading">
          <div><span className="step">03</span><h2>Choose repetition</h2></div>
          <p>The matrix is always balanced. Trial count changes total calls, never configuration coverage.</p>
        </div>
        <div className="trial-grid">
          {[1, 2, 3, 4, 5].map((count) => (
            <button key={count} type="button" className={`trial-option ${trials === count ? 'active' : ''}`} onClick={() => setTrials(count)}>
              <strong>{count}</strong><span>trial{count === 1 ? '' : 's'}</span><small>{count * 24} calls</small>
            </button>
          ))}
        </div>
        <div className="locked-strip">
          <span>Models <strong>{MODELS.length}</strong></span>
          <span>Temperatures <strong>{TEMPERATURES.length}</strong></span>
          <span>Thinking levels <strong>{THINKING_LEVELS.length}</strong></span>
          <span>Top-P <strong>{TOP_P}</strong></span>
          <span>Structured output <strong>ON</strong></span>
          <span>Max tokens <strong>{MAX_OUTPUT_TOKENS.toLocaleString()}</strong></span>
        </div>
        <div className="call-total"><span>Total provider calls</span><strong>{callCount}</strong><small>{trials} × 24 locked configurations</small></div>
        {error && <div className="alert error" role="alert">{error}</div>}
        <button className="primary-action" type="button" onClick={handleCreate} disabled={busy}>{busy ? 'Creating experiment…' : 'Create locked experiment'}</button>
        <p className="helper centered">Creating the experiment does not call Gemini. Calls begin only after you review the run screen.</p>
      </section>

      <section className="panel recent-panel">
        <div className="section-heading compact"><div><h2>Recent experiments</h2></div><p>Filesystem-backed runs in this standalone app.</p></div>
        {recent.length === 0 ? <div className="empty-state">No experiments created yet.</div> : (
          <div className="recent-list">
            {recent.map((item) => (
              <Link key={item.experimentId} className="recent-row" href={`/experiments/${item.experimentId}`}>
                <div><strong>{item.originalFilename}</strong><span>{item.experimentId}</span></div>
                <div><span className={`status-pill ${item.status}`}>{item.status}</span><small>{item.totalCalls} calls</small></div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function TextArtifactField({
  label,
  value,
  onChange,
  placeholder,
  accept,
  onFile,
  mono = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  accept: string;
  onFile: (file: File | undefined, setter: (value: string) => void) => Promise<void>;
  mono?: boolean;
}) {
  return (
    <div className="artifact-field">
      <div className="field-row"><label className="field-label">{label}</label><label className="text-file-button">Load file<input type="file" accept={accept} onChange={(event) => void onFile(event.target.files?.[0], onChange)} /></label></div>
      <textarea className={mono ? 'mono' : ''} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      <div className="char-count">{new Blob([value]).size.toLocaleString()} bytes</div>
    </div>
  );
}
