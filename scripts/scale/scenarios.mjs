#!/usr/bin/env node
// Scenarios of the shared-state harness, addressing backend A (backend-a) and B
// (backend-b) directly and the load balancer where a client would.
//
//   node scripts/scale/scenarios.mjs [all | <scenario>…]
//
// Scenarios: continue, replace, valkey-reset, stale-schema, fencing, drain, upgrade
// (authentication off), auth-session, auth-revoke, auth-bearer (authentication on).
// Each prints PASS, FAIL or SKIP with its evidence; the exit code is 1 when any
// selected scenario failed. They touch only the ontoforge-scale Compose project
// and the seed ontology fx_people_basic, which they load when it is missing;
// `upgrade` rewrites the storage of the harness database. The auth scenarios sign
// the development Keycloak's test users in (scripts/auth/lib.mjs) and create and
// delete an ontology of their own.

import {
  SEED, authEnabled, backendReady, chat, compose, composeAsync, ensureSeed, fakeControl, http, logsSince, modelPath,
  readThread, readiness, runtimePath, serviceByIp, sleep, sql, urls, waitFor,
} from './lib.mjs';
import { appLogin, call, deliverCallback, startAppLogin, userToken } from '../auth/lib.mjs';

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
    // Until its client is back, a server answers a storage error; then not found.
    let old;
    let tries = 0;
    await waitFor(async () => {
      tries++;
      old = await chat(base, 'old thread after the reset', first.threadId);
      return !(old.status === 500 && old.body?.error?.code === 'STORAGE_ERROR');
    }, 15, 200);
    run.check(`old thread on ${where} is unknown`, refusedAs(old, 404, 'THREAD_NOT_FOUND'), `${said(old)}, attempt ${tries}`);
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
 * Worker fencing across processes: A's claim is taken over by B while A waits
 * in the embed call, and A's late effects must be dropped. With B paused, a
 * person is updated (v1) through A; A claims its items and parks in the
 * fake's embed call. The claim's lease is expired in SQL, B resumes, the
 * person is updated again (v2) through B, and B takes the claim over and
 * builds v2. Then A's call is answered: A's v1 entry and completion must be
 * dropped, with one log line on A. (The generations are ready, so build
 * progress is not counted here; the integration tests cover it.)
 */
async function fencingScenario(run) {
  if (await lifecycleMissing(run)) return;
  const u = urls();
  const ns = `ont_${SEED.ontology}`;
  const stamp = Date.now();
  const persons = `${u.a}${runtimePath()}/entities/person`;
  const name = (version) => `fencing-${version}-${stamp}`;
  const created = await http('POST', persons, { name: name('v0') });
  const id = created.json?._id;
  if (!run.check('probe person on A', created.status === 201 && id, `HTTP ${created.status} ${id ?? ''}`)) return;
  const queuedOf = () => Number(sql(`SELECT count(*) FROM ${ns}.search_queue WHERE entity_id = '${id}'`));
  const semanticText = () => sql(
    `SELECT e.text FROM ${ns}.search_entry e JOIN ${ns}.search_generation g USING (generation_id)
     WHERE e.entity_id = '${id}' AND e.part_kind = 'self' AND g.representation = 'semantic' AND g.state = 'ready'`);
  let paused = false;
  try {
    run.check('v0 indexed', await waitFor(() => queuedOf() === 0, 30), `${queuedOf()} items queued`);
    compose(['pause', 'backend-b']);
    paused = true;
    await fakeControl({ holdEmbed: true });
    const since = new Date().toISOString();
    const v1 = await http('PATCH', `${persons}/${id}`, { name: name('v1') });
    run.check('v1 written through A', v1.status === 200, `HTTP ${v1.status}`);
    const parked = await waitFor(async () => (await fakeControl({})).json?.waiting > 0, 20, 200);
    if (!run.check('A waits in the embed call', parked, `${(await fakeControl({})).json?.waiting} parked`)) return;

    const expired = sql(
      `UPDATE ${ns}.search_queue SET lease_until = now() - interval '1 second'
       WHERE entity_id = '${id}' AND lease_until IS NOT NULL RETURNING part_kind`).split('\n').filter(Boolean);
    run.check("A's lease expired in SQL", expired.length > 0, `${expired.length} items`);
    await fakeControl({ holdEmbed: false, keepHeld: true });
    compose(['unpause', 'backend-b']);
    paused = false;
    const v2 = await http('PATCH', `${u.b}${runtimePath()}/entities/person/${id}`, { name: name('v2') });
    run.check('v2 written through B', v2.status === 200, `HTTP ${v2.status}`);
    const built = await waitFor(() => queuedOf() === 0 && semanticText().includes(name('v2')), 20, 250);
    run.check('B took the claim over and built v2', built, `entry "${semanticText()}", ${queuedOf()} queued`);

    await fakeControl({ holdEmbed: false });
    const marker = 'Search claim lost';
    const logged = await waitFor(() => logsSince('backend-a', since).includes(marker), 20, 500);
    const line = logsSince('backend-a', since).split('\n').find((l) => l.includes(marker)) ?? 'none';
    run.check('A logs its lost claim', logged, line.replace(/^\S+\s+\|\s*/, ''));
    await sleep(1000);
    const text = semanticText();
    run.check("entry keeps B's v2", text.includes(name('v2')) && !text.includes(name('v1')), `"${text}"`);
    const left = sql(`SELECT count(*), coalesce(max(attempts), 0) FROM ${ns}.search_queue WHERE entity_id = '${id}'`);
    run.check('queue empty, nothing failed', left === '0|0', `count|max attempts ${left}`);
  } finally {
    await fakeControl({ holdEmbed: false });
    if (paused) compose(['unpause', 'backend-b']);
    await http('DELETE', `${u.lb}${runtimePath()}/entities/person/${id}`);
    run.note('cleanup: probe person removed, backend-b running, embed calls released');
  }
}

/**
 * Draining a backend (dev-workers-lifecycle.md §4): a turn shorter than the
 * drain deadline finishes while A stops; a longer one is cut without a terminal
 * event and leaves the thread at its previous turn, released, so the next turn
 * on B runs (not THREAD_BUSY); reads through the LB see no error; A rejoins.
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
    const next = await chat(u.b, 'the next turn, on B', first.threadId);
    run.check('next turn on B is not busy', next.status === 200 && next.reply === 'user-messages:3', said(next));
    await composeAsync(['start', 'backend-a']);
    run.check('backend-a ready again', await backendUp(u.a), 'readiness');
  } finally {
    await fakeControl({ chatDelayMs: 0 });
    await composeAsync(['start', 'backend-a']);
    const counts = await loop.stop();
    run.check('GET loop through the LB', non2xx(counts) === 0, loop.describe());
  }
}

/**
 * A and B start together on storage one version behind: one upgrades it, the
 * other waits; both become ready on the current version, the data unchanged.
 * Version-8 storage is made in SQL while both are stopped: every namespace
 * loses step 9's design revision, and the recorded version goes back to 8.
 */
async function upgradeScenario(run) {
  const u = urls();
  const current = Number(sql('SELECT version FROM public.storage_version'));
  if (current !== 9) {
    run.skip(`the scenario rebuilds version 8 from version 9; storage is version ${current}`);
    return;
  }
  const before = { person: await entityTotal(u.lb, 'person'), company: await entityTotal(u.lb, 'company') };
  try {
    await composeAsync(['stop', 'backend-a', 'backend-b']);
    const since = new Date().toISOString();
    const namespaces = sql('SELECT namespace FROM public.ontology ORDER BY namespace').split('\n').filter(Boolean);
    sql(`${namespaces.map((ns) => `DROP TABLE ${ns}.design_revision;`).join(' ')} UPDATE public.storage_version SET version = 8;`);
    run.note(`storage set back to version ${sql('SELECT version FROM public.storage_version')}, ${namespaces.length} namespaces`);

    const t0 = Date.now();
    await composeAsync(['start', 'backend-a', 'backend-b']);
    const ready = await Promise.all([backendUp(u.a), backendUp(u.b)]);
    run.check('A and B ready', ready.every(Boolean), `${ready.map((ok) => (ok ? 'ready' : 'not ready')).join(' / ')} after ${Date.now() - t0} ms`);
    const lines = (marker) => ['backend-a', 'backend-b'].flatMap((service) =>
      logsSince(service, since).split('\n').filter((l) => l.includes(marker)).map((l) => l.replace(/\s+\|\s*/, ': ')));
    const upgrades = lines('Upgrading storage');
    run.check('exactly one upgrade across A and B', upgrades.length === 1, upgrades.join('; ') || 'none');
    run.note(`waited for the other: ${lines('Waiting for another server').map((l) => l.split(':')[0]).join(', ') || 'none'}`);
    const version = Number(sql('SELECT version FROM public.storage_version'));
    run.check('storage at the current version', version === current, `version ${version}`);
    const revisions = namespaces.filter((ns) => sql(`SELECT revision FROM ${ns}.design_revision`) === '1').length;
    run.check('every namespace has its design revision', revisions === namespaces.length, `${revisions} of ${namespaces.length}`);
    const after = { person: await entityTotal(u.lb, 'person'), company: await entityTotal(u.lb, 'company') };
    run.check('ontology data intact', JSON.stringify(after) === JSON.stringify(before),
      `before ${JSON.stringify(before)}, after ${JSON.stringify(after)}`);
  } finally {
    await composeAsync(['start', 'backend-a', 'backend-b']);
  }
}

// --- Authentication ------------------------------------------------------------

/** Which backend answered a call through the LB (nginx's X-Upstream). */
function upstreamName(answer) {
  const ip = answer.upstream?.split(':')[0];
  return (ip && serviceByIp()[ip]) ?? answer.upstream ?? '?';
}

const userOf = (answer) => answer.json?.user?.id ?? null;

/**
 * A browser session is shared state: signed in on A (login and callback on A), it is
 * used on B, through the LB and through the frontend (WEB_CLIENT_URL); a logout through B
 * ends it on A. Cookie POSTs carry WEB_CLIENT_URL's origin, as a browser on it would.
 */
async function authSessionScenario(run) {
  const u = urls();
  const { jar, callback } = await startAppLogin(u.a, 'reader');
  const back = await deliverCallback(u.a, callback, jar);
  if (!run.check('sign-in on A', back.status === 302 || back.status === 303,
    `GET A /api/auth/login → Keycloak → callback ${new URL(callback).origin}/api/auth/callback delivered to A: HTTP ${back.status} → ${back.location}, cookies ${jar.names(u.a).join(', ')}`)) return;
  const onA = await call(u.a, 'GET', '/api/auth/me', { jar });
  const id = userOf(onA);
  if (!run.check('session on A', id !== null, `HTTP ${onA.status}, user ${id}`)) return;
  const onB = await call(u.b, 'GET', '/api/auth/me', { jar });
  run.check('the same session on B', userOf(onB) === id, `HTTP ${onB.status}, user ${userOf(onB)}`);
  const throughLb = [];
  for (let i = 0; i < 4; i++) throughLb.push(await call(u.lb, 'GET', '/api/ontologies', { jar }));
  run.check('the session through the LB', throughLb.every((r) => r.status === 200),
    throughLb.map((r) => `${r.status} from ${upstreamName(r)}`).join(', '));
  const front = await call(u.front, 'GET', '/api/auth/me', { jar });
  run.check('the session through the frontend', userOf(front) === id, `HTTP ${front.status}, user ${userOf(front)}`);
  const out = await call(u.b, 'POST', '/api/auth/logout', { jar, origin: u.front });
  run.check('logout through B', out.status === 200 && typeof out.json?.logoutUrl === 'string', `HTTP ${out.status}`);
  const afterA = await call(u.a, 'GET', '/api/auth/me', { jar });
  run.check('the session ended on A', afterA.status === 200 && afterA.json?.user === null, `HTTP ${afterA.status}, user ${JSON.stringify(afterA.json?.user)}`);
  const afterLb = await call(u.lb, 'GET', '/api/ontologies', { jar });
  run.check('and through the LB', afterLb.status === 401, `HTTP ${afterLb.status} from ${upstreamName(afterLb)}`);
}

/**
 * Assignments are read on every request: a lens role granted and revoked through A
 * takes effect on B at once.
 */
async function authRevokeScenario(run) {
  const u = urls();
  const ontology = `scale_auth_${Date.now()}`;
  const admin = await appLogin(u.a, 'admin');
  const asAdmin = (method, path, body) => call(u.a, method, path, { jar: admin.jar, origin: u.front, body });
  const adminMe = await call(u.a, 'GET', '/api/auth/me', { jar: admin.jar });
  const adminId = userOf(adminMe);
  if (!run.check('administrator signed in on A', adminId !== null, `HTTP ${adminMe.status}, user ${adminId}`)) return;
  let creatorGrant = null;
  let created = false;
  try {
    if (!(adminMe.json?.assignments ?? []).some((a) => a.role === 'ontology_creator')) {
      const r = await asAdmin('POST', `/api/users/${adminId}/assignments`, { role: 'ontology_creator' });
      creatorGrant = r.json?.id ?? null;
      run.note(`administrator granted itself ontology_creator: HTTP ${r.status}`);
    }
    const o = await asAdmin('POST', '/api/ontologies', { key: ontology });
    created = o.status === 201;
    const lens = await asAdmin('POST', `/api/ontologies/${ontology}/model/lenses`, { key: 'l', name: 'l' });
    const type = await asAdmin('POST', `/api/ontologies/${ontology}/model/entity-types`, { key: 'item', displayName: 'Item' });
    if (!run.check('ontology, lens and type through A', created && lens.status === 201 && type.status === 201,
      `${ontology}: HTTP ${o.status}/${lens.status}/${type.status}`)) return;

    const reader = await appLogin(u.a, 'reader');
    const readerId = userOf(await call(u.a, 'GET', '/api/auth/me', { jar: reader.jar }));
    const granted = await asAdmin('POST', `/api/users/${readerId}/assignments`, { role: 'reader', ontologyKey: ontology, lensKey: 'l' });
    if (!run.check('reader granted on A', granted.status === 201, `HTTP ${granted.status}, user ${readerId}, assignment ${granted.json?.id}`)) return;
    const token = await userToken('reader');
    const path = `/api/ontologies/${ontology}/runtime/lenses/l/entities/item?limit=1`;
    const before = await call(u.b, 'GET', path, { token });
    run.check('reader reads on B', before.status === 200, `HTTP ${before.status}`);
    const revoked = await asAdmin('DELETE', `/api/users/${readerId}/assignments/${granted.json.id}`);
    run.check('revoked on A', revoked.status === 204, `HTTP ${revoked.status}`);
    const after = await call(u.b, 'GET', path, { token });
    run.check('the next request on B is refused', after.status === 403 || after.status === 404, `HTTP ${after.status}`);
    const lb = [await call(u.lb, 'GET', path, { token }), await call(u.lb, 'GET', path, { token })];
    run.check('and through the LB', lb.every((r) => r.status === 403 || r.status === 404),
      lb.map((r) => `${r.status} from ${upstreamName(r)}`).join(', '));
  } finally {
    if (created) run.note(`cleanup: ${ontology} deleted: HTTP ${(await asAdmin('DELETE', `/api/ontologies/${ontology}`)).status}`);
    if (creatorGrant) await asAdmin('DELETE', `/api/users/${adminId}/assignments/${creatorGrant}`);
  }
}

/** One user's bearer token is accepted by A and B alike; without it both refuse. */
async function authBearerScenario(run) {
  const u = urls();
  const token = await userToken('reader');
  const ids = [];
  for (const [where, base] of [['A', u.a], ['B', u.b]]) {
    const me = await call(base, 'GET', '/api/auth/me', { token });
    const list = await call(base, 'GET', '/api/ontologies', { token });
    const anonymous = await call(base, 'GET', '/api/ontologies');
    ids.push(userOf(me));
    run.check(`token accepted on ${where}`, userOf(me) !== null && list.status === 200 && anonymous.status === 401,
      `me user ${userOf(me)}, /api/ontologies ${list.status} with the token, ${anonymous.status} without`);
  }
  run.check('A and B name the same user', ids[0] !== null && ids[0] === ids[1], ids.join(' / '));
  const lb = [];
  for (let i = 0; i < 4; i++) lb.push(await call(u.lb, 'GET', '/api/ontologies', { token }));
  run.check('token through the LB', lb.every((r) => r.status === 200), lb.map((r) => `${r.status} from ${upstreamName(r)}`).join(', '));
}

const SCENARIOS = {
  continue: continueScenario,
  replace: replaceScenario,
  'valkey-reset': valkeyResetScenario,
  'stale-schema': staleSchemaScenario,
  fencing: fencingScenario,
  drain: drainScenario,
  upgrade: upgradeScenario,
  'auth-session': authSessionScenario,
  'auth-revoke': authRevokeScenario,
  'auth-bearer': authBearerScenario,
};

/** Scenarios that need authentication on; every other one needs it off. */
const AUTH_SCENARIOS = new Set(['auth-session', 'auth-revoke', 'auth-bearer']);

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
const auth = await authEnabled();
if (auth) console.log('Authentication on: the auth scenarios run, the others skip.');
else console.log(`Seed ${SEED.ontology}: ${await ensureSeed()}`);
await fakeControl({ chatDelayMs: 0, holdEmbed: false });

const results = [];
for (const name of selected) {
  console.log(`\n${name}`);
  const run = new Run(name);
  try {
    if (AUTH_SCENARIOS.has(name) && !auth) {
      run.skip('the stack runs without authentication (GET /api/auth/me → authentication:false); ./dev.sh scale up env/scale-auth.local.env');
    } else if (!AUTH_SCENARIOS.has(name) && auth) {
      run.skip('the stack runs with authentication on and this scenario calls without credentials; ./dev.sh scale up');
    } else {
      await SCENARIOS[name](run);
    }
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
