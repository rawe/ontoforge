// Shared utilities for OntoForge CLI scripts.
// Requires Node.js 18+ (built-in fetch, no external dependencies).

import { resolveBaseUrl, serverFetch } from './connection.mjs';

/**
 * Parse CLI arguments.
 * @param {Object<string, string[]>} flagDefs - Flag name to aliases map
 * @returns {{ flags: Object<string, string>, positional: string[] }}
 */
export function parseCliArgs(flagDefs = {}) {
  const raw = process.argv.slice(2);
  const flags = {};
  const positional = [];
  const aliases = new Map();
  for (const [name, alts] of Object.entries(flagDefs)) {
    for (const alt of alts) aliases.set(alt, name);
  }
  for (let i = 0; i < raw.length; i++) {
    if (aliases.has(raw[i])) {
      flags[aliases.get(raw[i])] = raw[++i];
    } else if (!raw[i].startsWith('-')) {
      positional.push(raw[i]);
    }
  }
  return { flags, positional };
}

/** The OntoForge server, resolved as connection.mjs describes. */
export function getBaseUrl(flags) {
  try {
    return resolveBaseUrl(flags.baseUrl);
  } catch (err) {
    die(err.message);
  }
}

/**
 * Resolve the ontology key every request is scoped to. There is no default
 * ontology on the server, so an absent key is a hard stop rather than a guess.
 * Priority: --ontology flag > ONTOFORGE_ONTOLOGY env.
 */
export function getOntologyKey(flags) {
  const key = flags.ontology || process.env.ONTOFORGE_ONTOLOGY;
  if (!key) {
    die(
      'no ontology key — pass --ontology <key> or set ONTOFORGE_ONTOLOGY. ' +
        'List the server\'s ontologies with GET /api/ontologies.',
    );
  }
  return key;
}

/** Route prefix for one ontology's modeling surface. */
export function modelPath(ontologyKey) {
  return `/api/ontologies/${encodeURIComponent(ontologyKey)}/model`;
}

/** Route prefix for one ontology's instance data seen through one lens. */
export function runtimePath(ontologyKey, lensKey) {
  return (
    `/api/ontologies/${encodeURIComponent(ontologyKey)}` +
    `/runtime/lenses/${encodeURIComponent(lensKey)}`
  );
}

/**
 * Make an API request. Throws on non-2xx responses.
 */
export async function api(baseUrl, path, options = {}) {
  const headers = { ...options.headers };
  if (options.body) headers['Content-Type'] = 'application/json';
  const res = await serverFetch(baseUrl, path, { ...options, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `${options.method || 'GET'} ${path} -> ${res.status}: ${text}`,
    );
  }
  if (res.status === 204) return null;
  return res.json();
}

/**
 * Paginate through a list endpoint returning { items, total, limit, offset }.
 */
export async function paginate(baseUrl, path, pageSize = 200) {
  const items = [];
  let offset = 0;
  for (;;) {
    const sep = path.includes('?') ? '&' : '?';
    const page = await api(
      baseUrl,
      `${path}${sep}limit=${pageSize}&offset=${offset}`,
    );
    items.push(...page.items);
    if (items.length >= page.total || page.items.length < pageSize) break;
    offset += pageSize;
  }
  return items;
}

/** The most calls one staging request lists, and roughly the most JSON bytes. */
const STAGE_ITEMS = 1000;
const STAGE_BYTES = 4 * 1024 * 1024;

/**
 * Write through changesets of one lens, committed in chunks: calls are staged
 * up to 1,000 per request, and when a changeset is full it is committed and
 * the next one started. `request(method, path, body)` returns the parsed
 * answer and throws on a non-2xx answer with `-> <status>: <message>` in its
 * message. Each call's answer goes to its `done` callback once staged.
 */
export function changesetWriter(request, prefix, note) {
  let changeset = null;
  let pending = [];
  let bytes = 0;
  let commits = 0;

  const start = async () => {
    if (changeset === null) changeset = (await request('POST', `${prefix}/changesets`, { note })).id;
  };
  const commit = async () => {
    if (changeset === null) return;
    await request('POST', `${prefix}/changesets/${changeset}/commit`, {});
    changeset = null;
    commits++;
  };
  const stage = (writes) => request('POST', `${prefix}/changesets/${changeset}/writes`, writes);
  const send = async () => {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    bytes = 0;
    const writes = batch.map((item) => item.write);
    await start();
    let answers;
    try {
      answers = await stage(writes);
    } catch (err) {
      // Full: commit it, and stage the same calls into the next one.
      if (!/-> 409: .*is full/s.test(err.message)) throw err;
      await commit();
      await start();
      answers = await stage(writes);
    }
    batch.forEach((item, i) => item.done?.(answers[i]));
  };

  return {
    /** Queue one staging call; `done(answer)` runs once it is staged. */
    async add(write, done) {
      const size = JSON.stringify(write).length;
      if (pending.length >= STAGE_ITEMS || (pending.length > 0 && bytes + size > STAGE_BYTES)) await send();
      pending.push({ write, done });
      bytes += size;
    },
    /** Stage what is queued and commit the last changeset. */
    async finish() {
      await send();
      await commit();
    },
    /** The draft changeset in use, if any: what a failed run leaves behind. */
    get changeset() {
      return changeset;
    },
    get commits() {
      return commits;
    },
  };
}

/**
 * Pick an unscoped lens (no includes) from an export payload — the only lens that
 * sees the whole schema. Returns null when the ontology has none; a scoped lens is
 * used only when the caller names it explicitly.
 */
export function pickLensKey(exportPayload) {
  const unscoped = (exportPayload.lenses || []).find((lens) => !lens.includes);
  return unscoped ? unscoped.key : null;
}

export function die(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}
