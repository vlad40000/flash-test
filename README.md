# FLASH-1 Theme Benchmark

A standalone, local-first application for testing **FLASH-1 Theme Extraction** against one fixed source image at a time.

> **Repository boundary:** this app is not part of Artlock/TattooLock. It has its own source tree, environment variables, run storage, and deployment boundary. It does not import Artlock runtime code, alter Artlock model routing, or write to an Artlock database.

## Locked experiment matrix

Every trial contains exactly 24 calls:

- Models: `gemini-3.5-flash`, `gemini-3.1-pro-preview`
- Temperatures: `0.2`, `0.4`, `0.8`, `1.0`
- Thinking levels: `low`, `medium`, `high`
- Top-P: `0.95` — locked
- Structured output: on — locked
- Max output tokens: `65,536` — locked
- Transport: Gemini Interactions API — locked
- Concurrency: four simultaneous calls — locked

The app executes strict four-call waves. Each wave contains two parameter cells, and each cell contains both models. The next wave does not begin until all calls in the active wave finish. Every call uses the same image bytes, detected MIME type, prompt, system instruction, and JSON Schema.

| Trials | Calls |
| ---: | ---: |
| 1 | 24 |
| 2 | 48 |
| 3 | 72 |
| 4 | 96 |
| 5 | 120 |

## Features

- Single-image experiment creation with byte-signature MIME detection for PNG, JPEG, and WebP.
- Exact 24-configuration job matrix with deterministic seeded scheduling.
- Four-worker Interactions API queue with pause, resume, stop, transient retry, and exponential backoff.
- Structured output through top-level `response_format` on every provider call.
- Raw response preservation, JSON parsing, JSON Schema validation, and recovery diagnostics kept as separate facts.
- Aggregate comparison by model, temperature, and thinking level.
- Fixed manual 100-point scoring rubric:
  - Schema and contract compliance: 20
  - Visible factual accuracy: 20
  - Style-system accuracy: 20
  - Theme abstraction quality: 15
  - Quarantine quality: 20
  - Uncertainty discipline: 5
- Evidence import for:
  - the supplied aggregate `evidence-suite.json` with an `images` array;
  - normalized record arrays;
  - `{ "records": [...] }` files;
  - legacy per-image evidence objects.
- Owner evidence review overlay: approved, needs revision, or rejected.
- JSON, JSONL, and CSV exports.
- Dual persistence: local filesystem in development and private Vercel Blob in Vercel deployments.
- Recovery of jobs persisted as `running` after a Node process restart.

## Setup

Requirements:

- Node.js 20 or newer
- A Gemini API key with access to both locked models
- For Vercel deployment: a **private Vercel Blob store** connected to the standalone benchmark project

```bash
npm install
cp .env.example .env.local
```

Set for local development:

```env
GEMINI_API_KEY=your_key_here
RUN_LIVE_GEMINI_TESTS=0
```

Local development defaults to `data/runs`. To test Blob locally, pull the connected project environment and set `FLASH_BENCHMARK_STORAGE=blob`.

Then:

```bash
npm run dev
```

Open `http://localhost:3000`.

The API key remains server-side. Creating an experiment does not call Gemini; calls begin only when **Start calls** is selected on the experiment page.

## Recommended workflow

1. Select one source image.
2. Attach `evidence-suite.json` when evidence is available.
3. Paste or load the exact FLASH-1 Theme Extraction prompt.
4. Paste or load the exact system instruction.
5. Review or replace the bundled FLASH Theme v4 structured-output schema.
6. Select the number of repeated trials.
7. Create the experiment and confirm the locked hashes and call count.
8. Start the provider calls.
9. Review schema validity and manually score completed responses.
10. Export the complete experiment bundle.

## Run storage

### Local development

Experiments are stored under:

```text
data/runs/<experiment-id>/
```

Local JSON state uses temporary-file + rename writes, and attempt history is appended to `attempts.jsonl`.

### Vercel deployment

Vercel application files under `/var/task` are read-only. This build therefore uses a **private Vercel Blob store** automatically whenever `VERCEL=1`. It does not write to `/var/task/data` and does not silently fall back to `/tmp`.

In the standalone benchmark Vercel project:

1. Open **Storage**.
2. Create and connect a **Private Blob** store.
3. Confirm `BLOB_READ_WRITE_TOKEN` is available to Production and Preview.
4. Redeploy the application.

All run artifacts are stored under the private Blob prefix:

```text
flash-theme-benchmark/runs/<experiment-id>/
```

Each run contains:

```text
manifest.json
source-image.<png|jpg|webp>
prompt.txt
system-instruction.txt
response-schema.json
jobs.json
attempts.jsonl
responses/
evidence.json             # when evidence was attached
scores.json               # after manual reviews
summary.json
```

If Blob is not connected, the server returns an explicit storage-configuration error instead of attempting to create `/var/task/data`. Source images and responses remain private.

## Verification

No paid calls:

```bash
npm run verify
```

Individual commands:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Two paid smoke-test calls, one per locked model:

```bash
GEMINI_API_KEY=... RUN_LIVE_GEMINI_TESTS=1 npm run test:live
```

The full 24-call matrix is never run by the automated test suite.

## Execution constraint

Blob persistence makes experiment state durable across Vercel Function instances. Start, resume, and retry routes register the active run with Next.js `after()` and configure a 300-second route duration. A long benchmark can still be interrupted if that duration is exhausted. Completed jobs and attempts remain stored and can be recovered by resuming the experiment; moving execution to a durable job service is a separate phase and must not change the locked benchmark contract.

## Explicitly out of scope

- Artlock/TattooLock modifications
- Lock Extraction or CORE-1A evaluation
- Image generation
- Additional models, temperature values, thinking levels, or top-P values
- Batch API or `generateContent` fallback
- Automatic LLM judging
- Automatic prompt rewriting or production promotion
- Silent provider parameter normalization
