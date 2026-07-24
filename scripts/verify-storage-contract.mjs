import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const storage = fs.readFileSync(path.join(root, 'src/lib/storage.ts'), 'utf8');
const startRoute = fs.readFileSync(path.join(root, 'src/app/api/experiments/[id]/start/route.ts'), 'utf8');
const retryRoute = fs.readFileSync(path.join(root, 'src/app/api/experiments/[id]/retry/route.ts'), 'utf8');
const pauseRoute = fs.readFileSync(path.join(root, 'src/app/api/experiments/[id]/pause/route.ts'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const checks = [
  ['Vercel selects Blob storage', storage.includes("if (env.VERCEL === '1')") && storage.includes("return 'blob'")],
  ['Vercel filesystem mode is rejected', storage.includes('Filesystem persistence cannot be used on Vercel')],
  ['private Blob writes are enforced', storage.includes("access: 'private'")],
  ['Blob overwrites use stable pathnames', storage.includes('addRandomSuffix: false') && storage.includes('allowOverwrite: true')],
  ['Blob reads bypass stale overwrite cache', storage.includes('useCache: false')],
  ['no /tmp persistence fallback exists', !storage.includes("os.tmpdir") && !storage.includes("'/tmp") && !storage.includes('"/tmp')],
  ['no /var/task write path exists', !storage.includes('/var/task')],
  ['local filesystem remains development-only', storage.includes("return configured === 'blob' ? 'blob' : 'filesystem'")],
  ['Vercel Blob dependency is pinned', pkg.dependencies?.['@vercel/blob'] === '2.6.1'],
  ['start route awaits asynchronous storage lookup', startRoute.includes('await experimentExists(id)')],
  ['start route surfaces storage unavailability', startRoute.includes('status: 503')],
  ['start route registers the run with Next after()', startRoute.includes('after(async () =>') && startRoute.includes('await startRun(id)')],
  ['retry route registers the run with Next after()', retryRoute.includes('after(async () =>') && retryRoute.includes('await startRun(id)')],
  ['resume route registers a fresh run with Next after()', pauseRoute.includes('after(async () =>') && pauseRoute.includes('await startRun(id)')],
  ['run routes declare a 300 second maximum duration', [startRoute, retryRoute, pauseRoute].every((source) => source.includes('maxDuration = 300'))],
];

let failed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failed++;
}

if (failed) {
  console.error(`\n${failed} storage contract check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} storage contract checks passed.`);
