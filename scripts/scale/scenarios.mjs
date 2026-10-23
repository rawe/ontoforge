#!/usr/bin/env node
// Scenarios of the shared-state harness, addressing backend A (backend-a) and B
// (backend-b) directly and the load balancer where a client would.
//
//   node scripts/scale/scenarios.mjs [all | <scenario>…]
//
// Scenarios: continue, replace, valkey-reset, stale-schema, fencing, drain.
// Each prints PASS, FAIL or SKIP with its evidence; the exit code is 1 when any
// selected scenario failed. They touch only the ontoforge-scale Compose project
// and the seed ontology fx_people_basic, which they load when it is missing.

import {
  SEED, backendReady, chat, compose, composeAsync, ensureSeed, fakeControl, http, modelPath,
  readThread, readiness, runtimePath, sleep, urls, waitFor,
} from './lib.mjs';

/** One scenario's checks and notes, printed as it goes. */
class Run {
  constructor(name) { this.name = name; this.failed = false; this.skipped = null; }
  note(text) { console.log(`    · ${text}`); }
  check(label, ok, evidence) {
    console.log(`    ${ok ? 'ok  ' : 'FAIL'} ${label} — ${evidence}`);
    if (!ok) this.failed = true;
    return ok;
  }
  skip(reason) { this.skipped = reason; }
}

/** A chat result in one line: status, refusal code, thread, reply, backend. */
function said(turn) {
  if (turn.status !== 200) {
    const code = turn.body?.error?.details?.code ?? turn.body?.error?.code ?? turn.error ?? '';
    return `HTTP ${turn.status} ${code}`.trim();
  }
  const end = turn.terminal === null ? 'no terminal event' : turn.terminal.type === 'final' ? `reply "${turn.reply}"` : `error ${turn.terminal.error?.code}`;
  return `HTTP 200, thread ${turn.threadId}, ${end}`;
}

const refusedAs = (turn, status, code) =>
  turn.status === status && turn.body?.error?.details?.code === code;

/** A background GET loop through the load balancer, counting answers by status. */
function getLoop(url) {
  const counts = {};
  let running = true;
  const done = (async () => {
    while (running) {
      const r = await http('GET', url, undefined, { timeoutMs: 10_000 });
      counts[r.status] = (counts[r.status] ?? 0) + 1;
      await sleep(50);
    }
  })();
  return {
    async stop() { running = false; await done; return counts; },
    describe: () => Object.entries(counts).map(([s, n]) => `${n}× ${s}`).join(', '),
  };
}

const non2xx = (counts) => Object.entries(counts).filter(([s]) => !s.startsWith('2')).reduce((n, [, c]) => n + c, 0);

async function backendUp(base, seconds = 90) {
  return waitFor(async () => (await backendReady(base)).ok, seconds);
}

async function entityTotal(base, type) {
  const r = await http('GET', `${base}${runtimePath()}/entities/${type}?limit=1`);
  return r.status === 200 ? r.json.total : `HTTP ${r.status}`;
}

// --- Scenarios ---------------------------------------------------------------

/** A conversation started on A continues on B and reads back whole on A and through the LB. */
async function continueScenario(run) {
  const u = urls();
  const first = await chat(u.a, 'first turn, on A');
  if (!run.check('turn 1 on A', first.status === 200 && first.reply === 'user-messages:1', said(first))) return;
  const second = await chat(u.b, 'second turn, on B', first.threadId);
  run.check('turn 2 on B sees turn 1', second.status === 200 && second.reply === 'user-messages:2', said(second));
  for (const [where, base] of [['A', u.a], ['LB', u.lb]]) {
    const read = await readThread(base, first.threadId);
    const roles = (read.json?.messages ?? []).map((m) => m.role[0]).join('');
    run.check(`read on ${where}`, read.status === 200 && roles === 'uaua', `HTTP ${read.status}, messages ${roles || '-'}`);
  }
}

/** Backend A stops; the conversation goes on on B; A comes back and continues it. */
async function replaceScenario(run) {
  const u = urls();
  const first = await chat(u.a, 'first turn, on A');
  if (!run.check('turn 1 on A', first.status === 200 && first.reply === 'user-messages:1', said(first))) return;
  const loop = getLoop(`${u.lb}${runtimePath()}/entities/person?limit=5`);
  try {
    await sleep(500);
    const t0 = Date.now();
    await composeAsync(['stop', 'backend-a']);
    run.note(`backend-a stopped in ${Date.now() - t0} ms`);
    const second = await chat(u.b, 'second turn, on B', first.threadId);
    run.check('turn 2 on B while A is down', second.status === 200 && second.reply === 'user-messages:2', said(second));
    await composeAsync(['start', 'backend-a']);
    const t1 = Date.now();
    const back = await backendUp(u.a);
    run.check('backend-a ready again', back, `${back ? 'ready' : 'not ready'} after ${Date.now() - t1} ms`);
    const third = await chat(u.a, 'third turn, on the new A', first.threadId);
    run.check('turn 3 on the new A sees turns 1-2', third.status === 200 && third.reply === 'user-messages:3', said(third));
  } finally {
    const counts = await loop.stop();
    run.check('GET loop through the LB', non2xx(counts) === 0, loop.describe());
    await composeAsync(['start', 'backend-a']);
  }
}

/** A Valkey restart loses every conversation, and nothing else. */
async function valkeyResetScenario(run) {
  const u = urls();
  const before = { person: await entityTotal(u.lb, 'person'), company: await entityTotal(u.lb, 'company') };
  const first = await chat(u.a, 'before the reset');
  if (!run.check('turn 1 on A', first.status === 200 && first.reply === 'user-messages:1', said(first))) return;
  const t0 = Date.now();
  await composeAsync(['restart', 'valkey']);
  const up = await waitFor(async () => {
    try { return compose(['exec', '-T', 'valkey', 'valkey-cli', 'ping']) === 'PONG'; } catch { return false; }
  }, 30);
  run.note(`valkey restarted, ${up ? 'PONG' : 'no PONG'} after ${Date.now() - t0} ms`);
  for (const [where, base] of [['A', u.a], ['B', u.b]]) {
    const old = await chat(base, 'old thread after the reset', first.threadId);
    run.check(`old thread on ${where} is unknown`, refusedAs(old, 404, 'THREAD_NOT_FOUND'), said(old));
  }
  let attempts = 0;
  let fresh;
  await waitFor(async () => {
    attempts++;
    fresh = await chat(u.b, 'new conversation after the reset');
    return fresh.status === 200 && fresh.reply === 'user-messages:1';
  }, 15);
  run.check('new conversation on B', fresh.status === 200 && fresh.reply === 'user-messages:1', `${said(fresh)}, attempt ${attempts}`);
  const after = { person: await entityTotal(u.lb, 'person'), company: await entityTotal(u.lb, 'company') };
  run.check('ontology data intact', JSON.stringify(after) === JSON.stringify(before),
    `before ${JSON.stringify(before)}, after ${JSON.stringify(after)}`);
}

/**
 * B reads (and caches) the schema; A changes it; B's next write must follow
 * the new schema: a property A added is accepted, a property A made required
 * is enforced.
 */
async function staleSchemaScenario(run) {
  const u = urls();
  const types = await http('GET', `${u.a}${modelPath()}/entity-types`);
  const person = (types.json ?? []).find?.((t) => t.key === 'person');
  if (!run.check('person type on A', types.status === 200 && person, `HTTP ${types.status}`)) return;
  const props = `${u.a}${modelPath()}/entity-types/${person.entityTypeId}/properties`;
  const list = await http('GET', props);
  const email = (list.json ?? []).find((p) => p.key === 'email');
  if (!run.check('email property on A', email, `HTTP ${list.status}`)) return;
  if (email.required) await http('PUT', `${props}/${email.propertyId}`, { required: false });

  const stamp = Date.now();
  const probeKey = `scale_probe_${stamp}`;
  const created = [];
  let probeId = null;
  const warm = async () => {
    const reads = [
      await http('GET', `${u.b}${runtimePath()}/schema/entity-types/person`),
      await http('GET', `${u.b}${runtimePath()}/entities/person?limit=1`),
    ];
    return reads.map((r) => r.status).join('/');
  };
  const createOn = async (base, label, extra = {}) => {
    const r = await http('POST', `${base}${runtimePath()}/entities/person`, { name: `stale-schema ${label} ${stamp}`, ...extra });
    if (r.status === 201 || r.status === 200) created.push(r.json?._id);
    return r;
  };
  try {
    run.note(`B warmed: ${await warm()}`);
    const added = await http('POST', props, { key: probeKey, displayName: 'Scale probe', dataType: 'string' });
    probeId = added.json?.propertyId ?? null;
    run.check('A adds property', added.status === 201 || added.status === 200, `HTTP ${added.status} ${probeKey}`);
    const withNew = await createOn(u.b, 'new-prop', { [probeKey]: 'x' });
    run.check('B accepts the property A added', withNew.status === 201 || withNew.status === 200,
      `HTTP ${withNew.status} ${withNew.json?.error?.code ?? ''}`.trim());

    run.note(`B warmed: ${await warm()}`);
    const req = await http('PUT', `${props}/${email.propertyId}`, { required: true });
    run.check('A makes email required', req.status === 200 && req.json?.required === true, `HTTP ${req.status}`);
    const onA = await createOn(u.a, 'no-email-A');
    run.check('A rejects a person without email (control)', onA.status === 422, `HTTP ${onA.status} ${onA.json?.error?.code ?? ''}`.trim());
    const onB = await createOn(u.b, 'no-email-B');
    run.check('B rejects a person without email', onB.status === 422, `HTTP ${onB.status} ${onB.json?.error?.code ?? ''}`.trim());
  } finally {
    await http('PUT', `${props}/${email.propertyId}`, { required: false });
    for (const id of created.filter(Boolean)) await http('DELETE', `${u.lb}${runtimePath()}/entities/person/${id}`);
    if (probeId) await http('DELETE', `${props}/${probeId}?cascade=true`);
    run.note(`cleanup: email optional again, ${created.length} probe entities and ${probeId ? 1 : 0} probe property removed`);
  }
}

/** The lifecycle scenarios need /readyz (stage 4); until a backend has it they skip. */
async function lifecycleMissing(run) {
  const probe = await http('GET', `${urls().a}/readyz`, undefined, { timeoutMs: 3000 });
  if (probe.status === 404 && !process.argv.includes('--force')) {
    run.skip('backend has no /readyz yet (worker fencing and drain are stage 4); --force runs it anyway');
    return true;
  }
  return false;
}

/**
 * Worker fencing across processes (dev-workers-lifecycle.md §4). Steps, once
 * stage 4 is in: stop backend-b; holdEmbed; update a person through A (A claims
 * the queue item and blocks in the embed call); expire the item's lease in SQL;
 * start backend-b (it takes the claim over and builds the entry); update the
 * person again (B builds that version); release the hold. Pass: the entry is
 * the second version, the queue is empty, A logs the lost claim, build done ≤ total.
 */
async function fencingScenario(run) {
  if (await lifecycleMissing(run)) return;
  run.skip('not written yet: needs the stage 4 claim fence and its log line');
}

/**
 * Draining a backend (dev-workers-lifecycle.md §4): a turn shorter than the
 * drain deadline finishes while A stops; a longer one is cut without a terminal
 * event and leaves the thread at its previous turn; reads through the LB see no
 * error; A rejoins.
 */
async function drainScenario(run) {
  if (await lifecycleMissing(run)) return;
  const u = urls();
  const loop = getLoop(`${u.lb}${runtimePath()}/entities/person?limit=5`);
  try {
    const first = await chat(u.a, 'first turn, on A');
    if (!run.check('turn 1 on A', first.status === 200, said(first))) return;

    await fakeControl({ chatDelayMs: 5000 });
    const short = chat(u.a, 'a 5 s turn while A drains', first.threadId);
    await sleep(1000);
    let t0 = Date.now();
    const stopping = composeAsync(['stop', 'backend-a']);
    const shortTurn = await short;
    await stopping;
    run.check('5 s turn finishes during the drain', shortTurn.reply === 'user-messages:2', said(shortTurn));
    run.note(`backend-a stopped after ${Date.now() - t0} ms`);
    await composeAsync(['start', 'backend-a']);
    run.check('backend-a ready again', await backendUp(u.a), 'readiness');

    await fakeControl({ chatDelayMs: 30_000 });
    const long = chat(u.a, 'a 30 s turn while A drains', first.threadId);
    await sleep(1000);
    t0 = Date.now();
    const stoppingAgain = composeAsync(['stop', 'backend-a']);
    const longTurn = await long;
    await stoppingAgain;
    const elapsed = Date.now() - t0;
    run.check('30 s turn is cut without a terminal event', longTurn.terminal === null, `${said(longTurn)} after ${elapsed} ms`);
    await fakeControl({ chatDelayMs: 0 });
    const read = await readThread(u.b, first.threadId);
    run.check('thread keeps its last completed turn', (read.json?.messages ?? []).length === 4,
      `HTTP ${read.status}, ${(read.json?.messages ?? []).length} messages`);
    await composeAsync(['start', 'backend-a']);
    run.check('backend-a ready again', await backendUp(u.a), 'readiness');
  } finally {
    await fakeControl({ chatDelayMs: 0 });
    await composeAsync(['start', 'backend-a']);
    const counts = await loop.stop();
    run.check('GET loop through the LB', non2xx(counts) === 0, loop.describe());
  }
}

const SCENARIOS = {
  continue: continueScenario,
  replace: replaceScenario,
  'valkey-reset': valkeyResetScenario,
  'stale-schema': staleSchemaScenario,
  fencing: fencingScenario,
  drain: drainScenario,
};

// --- Main --------------------------------------------------------------------

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const selected = args.length === 0 || args.includes('all') ? Object.keys(SCENARIOS) : args;
const unknown = selected.filter((name) => !(name in SCENARIOS));
if (unknown.length > 0) {
  console.error(`Unknown scenario: ${unknown.join(', ')}. Known: ${Object.keys(SCENARIOS).join(', ')}`);
  process.exit(2);
}

const ready = await readiness();
if (!Object.values(ready).every((s) => s.ok)) {
  console.error('The harness is not ready — ./dev.sh scale up, then ./dev.sh scale status.');
  process.exit(2);
}
console.log(`Seed ${SEED.ontology}: ${await ensureSeed()}`);
await fakeControl({ chatDelayMs: 0, holdEmbed: false });

const results = [];
for (const name of selected) {
  console.log(`\n${name}`);
  const run = new Run(name);
  try {
    await SCENARIOS[name](run);
  } catch (error) {
    run.check('scenario ran', false, String(error?.stack ?? error));
  }
  const result = run.skipped !== null ? 'SKIP' : run.failed ? 'FAIL' : 'PASS';
  console.log(`  ${result} ${name}${run.skipped ? ` — ${run.skipped}` : ''}`);
  results.push([name, result]);
}

console.log('\nSummary');
for (const [name, result] of results) console.log(`  ${result.padEnd(4)} ${name}`);
process.exit(results.some(([, r]) => r === 'FAIL') ? 1 : 0);
