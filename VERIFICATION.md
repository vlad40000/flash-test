# Verification — Vercel persistence correction

## Defect corrected

The prior build resolved its run root as `process.cwd()/data/runs`. In Vercel Functions, `process.cwd()` is under `/var/task`, so experiment creation attempted:

```text
mkdir /var/task/data
```

That filesystem is read-only and produced `ENOENT`/filesystem failures.

## Corrected contract

- Local development defaults to filesystem persistence under `data/runs`.
- Vercel (`VERCEL=1`) defaults to private Vercel Blob persistence.
- Vercel filesystem mode is rejected explicitly.
- There is no `/tmp` fallback because `/tmp` is ephemeral and not shared between instances.
- Blob objects use the prefix `flash-theme-benchmark/runs/<experiment-id>/`.
- Source images, prompts, responses, attempts, scores, and summaries use private access.
- Blob reads bypass stale overwrite cache through `useCache: false`.
- `experimentExists()` is asynchronous and the start route reports storage failures as HTTP 503.
- Start, resume, and retry execution is registered with Next.js `after()` instead of an untracked promise.
- Those execution routes declare `maxDuration = 300`.

## Required Vercel configuration

Connect a private Vercel Blob store to the standalone benchmark Vercel project. This injects `BLOB_READ_WRITE_TOKEN`. The existing `GEMINI_API_KEY` remains unchanged.

## Dependency change

Added:

```json
"@vercel/blob": "2.6.1"
```

The stale `package-lock.json` was removed because this environment could not access npm to regenerate a truthful lockfile. Run `npm install` once in a networked environment and commit the newly generated lockfile.

## Verification limits

Source-level checks are included below. Full dependency installation, Next.js build, and live Blob operations require npm/network access and a connected Blob store and were not falsely claimed as completed here.

## Checks completed in this environment

- Locked benchmark contract audit: 14/14 passed.
- Vercel storage/lifecycle contract audit: 15/15 passed.
- TypeScript/TSX syntax transpilation: 42 files, zero failures.
- Isolated strict typecheck of `src/lib/storage.ts` against the documented Blob method signatures: passed.
- Mock private-Blob runtime round trip: create, write, overwrite, read, append attempts, list, existence check, and delete passed.
- Local filesystem runtime round trip: passed.
- Search of runtime source for `/var/task/data`: no matches.

## Not completed here

- `npm install`
- Full repository `npm run typecheck`
- Full lint and Vitest suite
- Next.js production build
- Live Vercel Blob operation
- Live Gemini calls

Those require registry/network access and the connected Vercel project. The included audits do not substitute for the final Vercel deployment smoke test.
