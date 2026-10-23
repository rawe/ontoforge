#!/usr/bin/env node
// A small, honest benchmark of the shared-state harness: the same mixed REST
// load against backend A directly, against A alone through the load balancer
// (B stopped) and against A and B through it, then chat continuation through the load balancer with the fake
// model. Writes JSON and a Markdown table to .scratch/horizontal-scaling/evidence/.
//
//   node scripts/scale/bench.mjs [--duration 60] [--warmup 10] [--concurrency 32]
//                                [--chat-threads 20] [--chat-turns 6]
//
// REST mix per request: 70 % filtered entity list, 20 % entity by id,
// 10 % entity create. Entities it creates are deleted at the end.

import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import {
  ROOT, SEED, backendReady, chat, compose, composeAsync, dockerStatsAsync, serviceByIp, waitFor, ensureSeed, fakeControl, http, readiness, runtimePath, sleep, urls,
} from './lib.mjs';

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : Number(process.argv[index + 1]);
}
const opts = {
  durationS: option('duration', 60),
  warmupS: option('warmup', 10),
  concurrency: option('concurrency', 32),
  chatThreads: option('chat-threads', 20),
  chatTurns: option('chat-turns', 6),
};

const LIMITATIONS = [
  'Load generator, both backends, PostgreSQL, Valkey and nginx share one laptop CPU and one Docker VM: absolute numbers say nothing about production capacity, and scaling cannot look linear.',
  'One PostgreSQL serves both backends; it is the shared bottleneck by design.',
  'Backends are capped at 1 CPU each (compose.yml), so a single backend is CPU-bound early; the gain from a second one is the point, not the absolute rate.',
  'macOS-to-VM port forwarding adds latency to every request; the LB adds one more hop through its keepalive pool of upstream connections (compare lb-a with lb-ab, not direct-a with lb-ab).',
  'The fake model answers instantly: chat latency is the server-side turn cost (thread store, agent setup), not model latency.',
  'Both backends run their search worker throughout; creates in either run enqueue indexing work that any backend may build.',
];

const percentile = (sorted, p) => (sorted.length === 0 ? null : sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]);
const round = (n) => (n === null ? null : Math.round(n * 10) / 10);

function summarize(samples, seconds) {
  const ms = samples.map((s) => s.ms).sort((a, b) => a - b);
  const errors = samples.filter((s) => !s.ok);
  const byStatus = {};
  for (const s of errors) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
  return {
    requests: samples.length,
    rps: round(samples.length / seconds),
    p50: round(percentile(ms, 50)),
    p95: round(percentile(ms, 95)),
    p99: round(percentile(ms, 99)),
    errors: errors.length,
    errorsByStatus: byStatus,
  };
}

/** Answers per backend, from nginx's X-Upstream header (absent on direct access). */
function countUpstreams(samples) {
  const names = serviceByIp();
  const counts = {};
  for (const s of samples) {
    if (!s.upstream) continue;
    // A retried request lists every upstream it tried, the answering one last.
    const last = s.upstream.split(',').pop().trim();
    const name = names[last.split(':')[0]] ?? last;
    counts[name] = (counts[name] ?? 0) + 1;
  }
  return counts;
}

/** The mixed REST load against `base` for warmup + duration seconds. */
async function restRun(label, base, personIds, created) {
  const rest = `${base}${runtimePath()}`;
  const lists = [
    '/entities/person?limit=10&sort=name&filter.active=true',
    '/entities/person?limit=10&filter.age__gte=30',
    '/entities/company?limit=10&sort=name',
  ];
  let n = 0;
  const one = async () => {
    const r = Math.random();
    const started = performance.now();
    let op;
    let res;
    if (r < 0.7) {
      op = 'list';
      res = await http('GET', rest + lists[n++ % lists.length]);
    } else if (r < 0.9) {
      op = 'get';
      res = await http('GET', `${rest}/entities/person/${personIds[n++ % personIds.length]}`);
    } else {
      op = 'create';
      res = await http('POST', `${rest}/entities/person`, { name: `bench ${label} ${n++}`, email: 'bench@example.org', age: 40 });
      if (res.status === 201 || res.status === 200) created.push(res.json._id);
    }
    return { op, ms: performance.now() - started, status: res.status, ok: res.status >= 200 && res.status < 300, upstream: res.upstream };
  };

  console.log(`\n${label}: ${base}, ${opts.concurrency} loops, ${opts.warmupS} s warm-up + ${opts.durationS} s`);
  const warmEnd = Date.now() + opts.warmupS * 1000;
  const end = warmEnd + opts.durationS * 1000;
  const samples = [];
  const loop = async () => {
    while (Date.now() < end) {
      const sample = await one();
      if (Date.now() > warmEnd) samples.push(sample);
    }
  };
  const statsAt = sleep((opts.warmupS + opts.durationS / 2) * 1000).then(() => dockerStatsAsync());
  await Promise.all(Array.from({ length: opts.concurrency }, loop));
  const stats = await statsAt;

  const upstreams = countUpstreams(samples);
  const result = {
    label,
    target: base,
    all: summarize(samples, opts.durationS),
    byOp: Object.fromEntries(['list', 'get', 'create'].map((op) => [op, summarize(samples.filter((s) => s.op === op), opts.durationS)])),
    upstreams,
    dockerStats: stats,
  };
  console.log(`  ${result.all.requests} requests, ${result.all.rps} req/s, p50 ${result.all.p50} ms, p95 ${result.all.p95} ms, errors ${result.all.errors}`);
  return result;
}

/** Chat continuation through the LB: threads in parallel, turns in sequence. */
async function chatRun(base) {
  console.log(`\nchat: ${base}, ${opts.chatThreads} threads × ${opts.chatTurns} turns`);
  const turns = [];
  const thread = async () => {
    let threadId;
    for (let k = 1; k <= opts.chatTurns; k++) {
      const t = await chat(base, `turn ${k}`, threadId);
      threadId = threadId ?? t.threadId;
      turns.push({ turn: k, ms: t.ms, status: t.status, ok: t.status === 200 && t.reply === `user-messages:${k}`, upstream: t.upstream });
      if (!threadId) break;
    }
  };
  const started = performance.now();
  await Promise.all(Array.from({ length: opts.chatThreads }, thread));
  const seconds = (performance.now() - started) / 1000;
  const upstreams = countUpstreams(turns);
  const result = {
    label: 'chat-lb',
    target: base,
    turns: summarize(turns, seconds),
    firstTurn: summarize(turns.filter((t) => t.turn === 1), seconds),
    laterTurns: summarize(turns.filter((t) => t.turn > 1), seconds),
    wrongOrFailed: turns.filter((t) => !t.ok).length,
    upstreams,
    seconds: round(seconds),
  };
  console.log(`  ${result.turns.requests} turns, p50 ${result.turns.p50} ms, p95 ${result.turns.p95} ms, wrong or failed ${result.wrongOrFailed}`);
  return result;
}

/** Items the seed's search indices still have to build. */
async function indexPending(base) {
  const r = await http('GET', `${base}/api/ontologies/${SEED.ontology}/model/search-indices`);
  if (r.status !== 200) return null;
  return r.json
    .filter((i) => !['ready', 'unavailable', 'disabled', 'failed'].includes(i.status.state))
    .reduce((n, i) => n + i.status.representations.reduce((m, rep) => m + rep.pending, 0), 0);
}

/** Deletes what a run created and waits (at most 5 minutes) until indexing has
 * caught up, so every run starts from the same data. */
async function settle(base, ids) {
  const started = Date.now();
  const backlog = await indexPending(base);
  const cleanupFailed = await cleanup(base, ids.splice(0));
  let pending = await indexPending(base);
  while (pending !== null && pending > 0 && Date.now() - started < 300_000) {
    await sleep(2000);
    pending = await indexPending(base);
  }
  const seconds = round((Date.now() - started) / 1000);
  console.log(`  settled: index backlog ${backlog} at the end of the run, cleanup and catch-up ${seconds} s, ${pending} left`);
  return { indexBacklogAtEnd: backlog, settleSeconds: seconds, pendingAfter: pending, cleanupFailed };
}

async function cleanup(base, ids) {
  let next = 0;
  let failed = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++];
      const r = await http('DELETE', `${base}${runtimePath()}/entities/person/${id}`);
      if (r.status >= 300 && r.status !== 404) failed++;
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  if (failed > 0) console.warn(`  cleanup: ${failed} of ${ids.length} deletes failed; their persons are named "bench …"`);
  return failed;
}

function markdown(report) {
  const row = (r) => `| ${r.label} | ${r.all.requests} | ${r.all.rps} | ${r.all.p50} | ${r.all.p95} | ${r.all.p99} | ${r.all.errors} | ${r.after?.indexBacklogAtEnd ?? '-'} |`;
  const statsRows = (r) => (r.dockerStats ?? []).map((s) => `| ${r.label} | ${s.name.replace('ontoforge-scale-', '')} | ${s.cpu} | ${s.mem} |`);
  const c = report.chat;
  return [
    `# Scale harness benchmark — ${report.startedAt}`,
    '',
    `Host: ${report.host.cpus} CPUs, Docker VM ${report.host.dockerCpus} CPUs. Checkout at ${report.commit}${report.dirty ? ' with uncommitted server changes' : ''}; server image ${report.image} (built from the working tree of that moment).`,
    `REST mix 70 % list / 20 % get / 10 % create, ${report.options.concurrency} concurrent loops, ${report.options.warmupS} s warm-up, ${report.options.durationS} s measured. Backends capped at 1 CPU each. Each run starts from the fixture's data: what a run created is deleted and indexing has caught up before the next one.`,
    '',
    '| Run | Requests | Req/s | p50 ms | p95 ms | p99 ms | Errors | Index backlog at end |',
    '|---|---|---|---|---|---|---|---|',
    ...report.rest.map(row),
    '',
    `Runs: direct-a = backend A on its own port; lb-a = through the LB with B stopped; lb-ab = through the LB to A and B. LB distribution in lb-ab: ${JSON.stringify(report.rest.find((r) => r.label === 'lb-ab')?.upstreams ?? {})}.`,
    '',
    `Chat through the LB (fake model): ${c.turns.requests} turns (${report.options.chatThreads} threads × ${report.options.chatTurns}), p50 ${c.turns.p50} ms, p95 ${c.turns.p95} ms; first turn p50 ${c.firstTurn.p50} ms, later turns p50 ${c.laterTurns.p50} / p95 ${c.laterTurns.p95} ms; wrong or failed ${c.wrongOrFailed}. Distribution: ${JSON.stringify(c.upstreams)}.`,
    '',
    '`docker stats --no-stream`, mid-run:',
    '',
    '| Run | Container | CPU | Memory |',
    '|---|---|---|---|',
    ...report.rest.flatMap(statsRows),
    '',
    'Limitations:',
    '',
    ...report.limitations.map((l) => `- ${l}`),
    '',
  ].join('\n');
}

// --- Main --------------------------------------------------------------------

const ready = await readiness();
if (!Object.values(ready).every((s) => s.ok)) {
  console.error('The harness is not ready — ./dev.sh scale up, then ./dev.sh scale status.');
  process.exit(2);
}
await ensureSeed();
await fakeControl({ chatDelayMs: 0, holdEmbed: false });
const u = urls();
const people = await http('GET', `${u.lb}${runtimePath()}/entities/person?limit=100`);
const personIds = (people.json?.items ?? []).map((p) => p._id);
if (personIds.length === 0) throw new Error(`no ${SEED.ontology} persons to read (HTTP ${people.status})`);

const git = (args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
const startedAt = new Date().toISOString();
const report = {
  startedAt,
  commit: git(['rev-parse', '--short', 'HEAD']),
  dirty: git(['status', '--porcelain', '--', 'server']) !== '',
  image: spawnSync('docker', ['image', 'inspect', '--format', '{{slice .Id 7 19}}, built {{.Created}}', 'ontoforge-scale/server:dev'], { encoding: 'utf8' }).stdout.trim(),
  options: opts,
  host: { cpus: (await import('node:os')).cpus().length, dockerCpus: spawnSync('docker', ['info', '--format', '{{.NCPU}}'], { encoding: 'utf8' }).stdout.trim(), docker: compose(['version', '--short']) },
  rest: [],
  chat: null,
  limitations: LIMITATIONS,
};

const created = [];
try {
  // The same load three ways: A alone directly, A alone behind the LB (B
  // stopped), and A and B behind the LB. The second isolates the LB's own cost.
  for (const [label, base] of [['direct-a', u.a], ['lb-a', u.lb], ['lb-ab', u.lb]]) {
    if (label === 'lb-a') await composeAsync(['stop', 'backend-b']);
    if (label === 'lb-ab') {
      await composeAsync(['start', 'backend-b']);
      if (!(await waitFor(async () => (await backendReady(u.b)).ok, 90))) throw new Error('backend-b did not come back');
      await sleep(6000); // nginx re-resolves backend-b (resolver valid=5s)
    }
    const run = await restRun(label, base, personIds, created);
    run.after = await settle(u.lb, created);
    report.rest.push(run);
  }
  report.chat = await chatRun(u.lb);
} finally {
  await composeAsync(['start', 'backend-b']);
  if (created.length > 0) await cleanup(u.lb, created);
}

const dir = join(ROOT, '.scratch', 'horizontal-scaling', 'evidence');
mkdirSync(dir, { recursive: true });
const stem = `bench-${startedAt.replace(/[:.]/g, '-').slice(0, 19)}`;
writeFileSync(join(dir, `${stem}.json`), JSON.stringify(report, null, 2));
const md = markdown(report);
writeFileSync(join(dir, `${stem}.md`), md);
console.log(`\n${md}`);
console.log(`Written: ${join(dir, stem)}.{json,md}`);
