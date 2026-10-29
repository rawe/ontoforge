#!/usr/bin/env node
// Prints the HTTP status of every service of the shared-state harness (the frontend too
// when the backends run with authentication on: it is their WEB_CLIENT_URL).
//
//   node scripts/scale/ready.mjs              one check; exit 1 unless all answer 200
//   node scripts/scale/ready.mjs --wait 120   repeat until all answer 200, at most 120 s

import { readiness, waitFor } from './lib.mjs';

const index = process.argv.indexOf('--wait');
const seconds = index < 0 ? 0 : Number(process.argv[index + 1] ?? 120);

let last = null;
const ok = await waitFor(async () => {
  last = await readiness();
  return Object.values(last).every((s) => s.ok);
}, seconds, 2000);

for (const [service, s] of Object.entries(last)) {
  console.log(`  ${service.padEnd(12)} ${String(s.status || 'down').padEnd(5)} ${s.url}${s.route}`);
}
if (!ok) {
  console.error(seconds > 0 ? `Not ready after ${seconds} s.` : 'Not ready.');
  process.exit(1);
}
