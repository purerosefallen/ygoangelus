import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const lockPath = 'package-lock.json';
const original = readFileSync(lockPath, 'utf8');
const cache = process.env.NPM_TARBALL_CACHE;
const args = [
  'ci',
  '--no-audit',
  '--no-fund',
  '--prefer-offline',
  '--maxsockets=12',
  '--fetch-retries=1',
  '--fetch-timeout=60000',
  '--replace-registry-host=never',
];

function install() {
  const result = spawnSync('npm', args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

let status = 1;
if (cache) {
  const lock = JSON.parse(original);
  // Route only public npm tarballs through the download cache. Preserve the
  // version and SRI fields; npm verifies the bytes against the committed lock.
  for (const entry of Object.values(lock.packages)) {
    if (entry.resolved?.startsWith('https://registry.npmjs.org/')) {
      entry.resolved = cache.replace(/\/$/, '') + '/' + entry.resolved;
    }
  }
  try {
    writeFileSync(lockPath, JSON.stringify(lock));
    status = install();
  } finally {
    writeFileSync(lockPath, original);
  }
}
if (status !== 0) status = install();
process.exitCode = status;
