// Shared helpers for the shared-state harness scripts: the Compose project,
// where its services are published, HTTP and NDJSON chat calls, the seed
// fixture. Node 22, no dependencies.

import { spawnSync, spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const COMPOSE_FILE = join(ROOT, 'docker', 'scale', 'compose.yml');

/** The seed: a development fixture (fixtures/README.md), its unscoped lens
 * and the built-in agent every lens has. */
export const SEED = { fixture: 'people_basic', ontology: 'fx_people_basic', lens: 'test_lens', agent: '_default' };

// --- Compose ---------------------------------------------------------------

/** Runs `docker compose -f docker/scale/compose.yml <args>`; throws on a non-zero exit. */
export function compose(args, { quiet = true } = {}) {
  const result = spawnSync('docker', ['compose', '-f', COMPOSE_FILE, ...args], {
    encoding: 'utf8',
    stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`docker compose ${args.join(' ')} failed: ${(result.stderr ?? '').trim()}`);
  }
  return (result.stdout ?? '').trim();
}

/** `compose` without blocking the event loop, so load and GET loops keep running. */
export function composeAsync(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['compose', '-f', COMPOSE_FILE, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('close', (code) => code === 0
      ? resolve(out.trim())
      : reject(new Error(`docker compose ${args.join(' ')} failed: ${err.trim()}`)));
  });
}

let published = null;

/** Base URLs of the services as compose.yml publishes them on the host (`front`: profile ui). */
export function urls() {
  if (published) return published;
  const config = JSON.parse(compose(['--profile', 'ui', 'config', '--format', 'json']));
  const port = (service) => {
    const entry = config.services?.[service]?.ports?.[0];
    if (!entry) throw new Error(`service ${service} publishes no port in ${COMPOSE_FILE}`);
    return `http://localhost:${entry.published}`;
  };
  published = { a: port('backend-a'), b: port('backend-b'), lb: port('lb'), fake: port('fake-ollama'), front: port('frontend') };
  return published;
}

/** CPU and memory of the project's running containers (`docker stats --no-stream`). */
export function dockerStats() {
  const ids = compose(['ps', '-q']).split('\n').filter(Boolean);
  if (ids.length === 0) return [];
  const result = spawnSync('docker', ['stats', '--no-stream', '--format', '{{json .}}', ...ids], { encoding: 'utf8' });
  return result.stdout.split('\n').filter(Boolean).map((line) => {
    const s = JSON.parse(line);
    return { name: s.Name, cpu: s.CPUPerc, mem: s.MemUsage, memPerc: s.MemPerc };
  });
}

/** Service name by container IP address, to name the backend in nginx's X-Upstream. */
export function serviceByIp() {
  const ids = compose(['ps', '-q']).split('\n').filter(Boolean);
  const format = '{{index .Config.Labels "com.docker.compose.service"}} {{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}';
  const result = spawnSync('docker', ['inspect', '--format', format, ...ids], { encoding: 'utf8' });
  const map = {};
  for (const line of result.stdout.split('\n').filter(Boolean)) {
    const [service, ...ips] = line.trim().split(/\s+/);
    for (const ip of ips) map[ip] = service;
  }
  return map;
}

/** `dockerStats` without blocking the event loop (for use during a load run). */
export function dockerStatsAsync() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--stats'], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.on('close', () => { try { resolve(JSON.parse(out)); } catch { resolve([]); } });
  });
}

// --- HTTP ------------------------------------------------------------------

/** One request; never throws for an HTTP status. `status` 0 means no answer. */
export async function http(method, url, body, { timeoutMs = 30_000 } = {}) {
  try {
    const response = await fetch(url, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    return { status: response.status, json, text, upstream: response.headers.get('x-upstream') };
  } catch (error) {
    return { status: 0, json: null, text: String(error?.cause?.code ?? error?.message ?? error), upstream: null };
  }
}

export const runtimePath = (o = SEED.ontology, l = SEED.lens) => `/api/ontologies/${o}/runtime/lenses/${l}`;
export const modelPath = (o = SEED.ontology) => `/api/ontologies/${o}/model`;

/**
 * One chat turn with the seed's agent: POST, then read the NDJSON stream to its
 * end. Returns the HTTP status, the thread id, the terminal event (`final` or
 * `error`, null when the stream ended without one) and the error body of a
 * refused request.
 */
export async function chat(base, message, threadId, { timeoutMs = 120_000 } = {}) {
  const url = `${base}${runtimePath()}/ai/assistants/agents/${SEED.agent}/chat`;
  const started = performance.now();
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(threadId ? { message, threadId } : { message }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return { status: 0, error: String(error?.cause?.code ?? error?.message ?? error), ms: performance.now() - started };
  }
  const upstream = response.headers.get('x-upstream');
  if (!(response.headers.get('content-type') ?? '').includes('ndjson')) {
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: response.status, body: json ?? text, upstream, ms: performance.now() - started };
  }
  const events = [];
  let buffer = '';
  try {
    for await (const chunk of response.body) {
      buffer += Buffer.from(chunk).toString('utf8');
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) events.push(JSON.parse(line));
      }
    }
  } catch (error) {
    events.push({ type: '_cut', reason: String(error?.cause?.code ?? error?.message ?? error) });
  }
  const terminal = events.find((e) => e.type === 'final' || e.type === 'error') ?? null;
  return {
    status: response.status,
    threadId: events.find((e) => e.type === 'thread')?.threadId ?? null,
    terminal,
    reply: terminal?.type === 'final' ? terminal.reply : null,
    events,
    upstream,
    ms: performance.now() - started,
  };
}

/** Reads a thread of the seed's agent back. */
export function readThread(base, threadId) {
  return http('GET', `${base}${runtimePath()}/ai/assistants/agents/${SEED.agent}/threads/${threadId}`);
}

// --- Readiness and seed ----------------------------------------------------

/** Whether a backend is ready: /readyz once the server has it, else its info route. */
export async function backendReady(base) {
  const ready = await http('GET', `${base}/readyz`, undefined, { timeoutMs: 3000 });
  if (ready.status !== 404) return { ok: ready.status === 200, status: ready.status, route: '/readyz' };
  const info = await http('GET', `${base}/api/server/info`, undefined, { timeoutMs: 3000 });
  return { ok: info.status === 200, status: info.status, route: '/api/server/info' };
}

/** Whether the backend at `base` runs with authentication on (its /api/auth/me says so). */
export async function authEnabled(base = urls().a) {
  const me = await http('GET', `${base}/api/auth/me`, undefined, { timeoutMs: 3000 });
  return me.status === 200 && me.json?.authentication === true;
}

/** The status of every published service; the frontend too when authentication is on (it is WEB_CLIENT_URL). */
export async function readiness() {
  const u = urls();
  const fake = await http('GET', `${u.fake}/control`, undefined, { timeoutMs: 3000 });
  const lb = await http('GET', `${u.lb}/api/server/info`, undefined, { timeoutMs: 3000 });
  const status = {
    'backend-a': { url: u.a, ...(await backendReady(u.a)) },
    'backend-b': { url: u.b, ...(await backendReady(u.b)) },
    lb: { url: u.lb, ok: lb.status === 200, status: lb.status, route: '/api/server/info' },
    'fake-ollama': { url: u.fake, ok: fake.status === 200, status: fake.status, route: '/control' },
  };
  if (await authEnabled(u.a)) {
    const front = await http('GET', `${u.front}/api/server/info`, undefined, { timeoutMs: 3000 });
    status.frontend = { url: u.front, ok: front.status === 200, status: front.status, route: '/api/server/info' };
  }
  return status;
}

/** Waits until `check()` is true, up to `seconds`; returns whether it became true. */
export async function waitFor(check, seconds, intervalMs = 1000) {
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    if (await check()) return true;
    if (Date.now() >= deadline) return false;
    await sleep(intervalMs);
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Loads the seed fixture through the load balancer unless it is there. */
export async function ensureSeed() {
  const u = urls();
  const existing = await http('GET', `${u.lb}/api/ontologies/${SEED.ontology}`);
  if (existing.status === 200) return 'present';
  if (existing.status === 401) throw new Error('the harness runs with authentication on; the seed needs env/scale.env (./dev.sh scale up)');
  if (existing.status !== 404) throw new Error(`seed check answered ${existing.status}: ${existing.text}`);
  const result = spawnSync(process.execPath, [join(ROOT, 'fixtures', 'fixture.mjs'), 'load', SEED.fixture, '--base-url', u.lb], {
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error(`fixture load ${SEED.fixture} failed`);
  return 'loaded';
}

/** Runs one SQL statement against the harness PostgreSQL (psql in its
 * container); rows as lines, columns separated by `|`. */
export function sql(statement) {
  return compose(['exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'ontoforge', '-qAt', '-c', statement]);
}

/** A service's log lines since a moment (an ISO timestamp). */
export function logsSince(service, since) {
  return compose(['logs', '--no-color', '--since', since, service]);
}

/** Sets the fake model server's knobs ({chatDelayMs, holdEmbed, keepHeld}). */
export function fakeControl(settings) {
  return http('POST', `${urls().fake}/control`, settings);
}

// `node lib.mjs --stats` prints dockerStats() as JSON (used by dockerStatsAsync).
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === '--stats') {
  process.stdout.write(JSON.stringify(dockerStats()));
}
