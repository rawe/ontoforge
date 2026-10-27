#!/usr/bin/env node
// Development fixtures: load, save and unload known ontologies on a running
// OntoForge server. Plain Node 18+, no dependencies. See fixtures/README.md.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = 'Usage: node fixtures/fixture.mjs <load|save|unload> <name> [--base-url URL]';
const ONTOLOGIES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'ontologies');
const NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const MAX_ONTOLOGY_KEY_LENGTH = 59;
const PAGE_SIZE = 200;
const ENTITY_SYSTEM_FIELDS = ['_id', '_entityTypeKey', '_createdAt', '_updatedAt', '_identity'];
const RELATION_SYSTEM_FIELDS = ['_id', '_relationTypeKey', '_createdAt', '_updatedAt'];
// The most calls one staging request lists, and roughly the most JSON bytes.
const STAGE_ITEMS = 1000;
const STAGE_BYTES = 4 * 1024 * 1024;
const INDEX_POLL_MS = 2000;
const INDEX_WAIT_TIMEOUT_MS = 15 * 60 * 1000;
// Index states with nothing left to build: `unavailable` is a semantic-only
// index without an embedding provider, `disabled` a switched-off managed one.
const INDEX_DONE_STATES = ['ready', 'unavailable', 'disabled'];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const positional = [];
  let baseUrl;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base-url') baseUrl = argv[++i];
    else if (argv[i].startsWith('--base-url=')) baseUrl = argv[i].slice('--base-url='.length);
    else positional.push(argv[i]);
  }
  if (positional.length !== 2) fail(USAGE);
  const [command, name] = positional;
  if (!['load', 'save', 'unload'].includes(command)) fail(USAGE);
  if (!NAME_PATTERN.test(name)) fail(`fixture name "${name}" must match ${NAME_PATTERN}`);
  const key = `fx_${name}`;
  if (key.length > MAX_ONTOLOGY_KEY_LENGTH) {
    fail(`ontology key "${key}" is longer than ${MAX_ONTOLOGY_KEY_LENGTH} characters`);
  }
  baseUrl = (baseUrl || process.env.ONTOFORGE_BASE_URL || 'http://localhost:8000').replace(/\/+$/, '');
  return { command, name, key, baseUrl, dir: join(ONTOLOGIES_DIR, name) };
}

// One request; returns the parsed JSON body. A non-2xx answer throws with
// the server's own message.
async function request(baseUrl, method, path, body) {
  let res;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error(`cannot connect to ${baseUrl} — is the OntoForge server running?`);
  }
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      const envelope = JSON.parse(text);
      if (envelope.error?.message) {
        message = envelope.error.message;
        if (envelope.error.details) message += ` ${JSON.stringify(envelope.error.details)}`;
      }
    } catch {
      // not the JSON envelope; keep the raw text
    }
    throw new HttpError(res.status, `${method} ${path} -> ${res.status}: ${message}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch (err) {
    fail(`cannot read ${file}: ${err.message}`);
  }
}

function writeJson(file, value) {
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function unscopedLensKey(design) {
  const lens = (design.lenses || []).find((l) => l.includes == null);
  if (!lens) throw new Error('the schema has no unscoped lens (one whose "includes" is null); fixtures need one');
  return lens.key;
}

function without(record, fields) {
  const out = {};
  for (const [k, v] of Object.entries(record)) if (!fields.includes(k)) out[k] = v;
  return out;
}

// Write through changesets of one lens, committed in chunks: calls are
// staged up to STAGE_ITEMS per request, and a full changeset is committed
// and the next one started. Each call's answer goes to its `done` callback.
function changesetWriter(baseUrl, prefix) {
  let changeset = null;
  let pending = [];
  let bytes = 0;
  let commits = 0;
  let stagedHere = 0;
  const start = async () => {
    if (changeset === null) changeset = (await request(baseUrl, 'POST', `${prefix}/changesets`, { note: 'Fixture load' })).id;
  };
  const commit = async () => {
    if (changeset === null) return;
    await request(baseUrl, 'POST', `${prefix}/changesets/${changeset}/commit`, {});
    changeset = null;
    stagedHere = 0;
    commits++;
  };
  const stage = (writes) => request(baseUrl, 'POST', `${prefix}/changesets/${changeset}/writes`, writes);
  // Stage one batch whole. Full: commit what this changeset holds and
  // stage the batch into the next one; a batch larger than an empty
  // changeset holds is split in halves.
  const sendBatch = async (batch) => {
    await start();
    let answers;
    try {
      answers = await stage(batch.map((item) => item.write));
    } catch (err) {
      if (!(err instanceof HttpError && err.status === 409 && err.message.includes('is full'))) throw err;
      if (stagedHere > 0) {
        await commit();
        return sendBatch(batch);
      }
      if (batch.length === 1) throw err;
      const half = Math.ceil(batch.length / 2);
      await sendBatch(batch.slice(0, half));
      return sendBatch(batch.slice(half));
    }
    stagedHere += batch.length;
    batch.forEach((item, i) => item.done?.(answers[i]));
  };
  const send = async () => {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    bytes = 0;
    await sendBatch(batch);
  };
  return {
    async add(write, done) {
      const size = JSON.stringify(write).length;
      if (pending.length >= STAGE_ITEMS || (pending.length > 0 && bytes + size > STAGE_BYTES)) await send();
      pending.push({ write, done });
      bytes += size;
    },
    async finish() {
      await send();
      await commit();
    },
    get commits() {
      return commits;
    },
  };
}

// Search indices build their entries in the background after every write;
// wait until no index has anything left to build. A timeout or failed
// items only warn: the data is loaded and the worker keeps going.
async function waitForSearchIndices(baseUrl, key) {
  const deadline = Date.now() + INDEX_WAIT_TIMEOUT_MS;
  let last = '';
  for (;;) {
    const indices = await request(baseUrl, 'GET', `/api/ontologies/${key}/model/search-indices`);
    const open = indices.filter((i) => !INDEX_DONE_STATES.includes(i.status.state) && i.status.state !== 'failed');
    const failed = indices.filter((i) => i.status.state === 'failed');
    const pending = open.reduce(
      (n, i) => n + i.status.representations.reduce((m, r) => m + r.pending, 0),
      0,
    );
    const line = `  search indices: ${indices.length - open.length - failed.length}/${indices.length} done` +
      (open.length ? `, ${pending} items pending in ${open.map((i) => i.key).join(', ')}` : '');
    if (line !== last) console.log(line);
    last = line;
    if (open.length === 0) {
      for (const index of failed) {
        const errors = index.status.lastErrors.map((e) => e.message).join('; ');
        console.warn(`  Warning: search index ${index.key} has failed items${errors ? `: ${errors}` : ''} — rebuild it once the cause is fixed`);
      }
      return;
    }
    if (Date.now() > deadline) {
      console.warn(`  Warning: search indices still building after ${INDEX_WAIT_TIMEOUT_MS / 60000} minutes — the data is loaded; they keep building in the background`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, INDEX_POLL_MS));
  }
}

async function load({ name, key, baseUrl, dir }) {
  if (!existsSync(dir)) fail(`no fixture folder ${dir}`);
  const schema = readJson(join(dir, 'schema.json'));
  const data = readJson(join(dir, 'data.json'));

  try {
    await request(baseUrl, 'POST', '/api/ontologies', { key });
  } catch (err) {
    if (err.status === 409) fail(`fixture "${name}" is already loaded as ontology "${key}" — run unload first`);
    fail(err.message);
  }
  console.log(`Created ontology ${key}`);

  try {
    await request(baseUrl, 'POST', `/api/ontologies/${key}/model/import`, schema);
    console.log('  schema imported');

    const prefix = `/api/ontologies/${key}/runtime/lenses/${unscopedLensKey(schema)}`;
    // The same loading path as the sync skill's import: chunked changesets,
    // puts where an identity or a one-per-pair type can match.
    const withIdentity = new Set(
      (schema.entityTypes || []).filter((t) => (t.identityProperties || []).length > 0).map((t) => t.key),
    );
    const onePerPair = new Set((schema.relationTypes || []).filter((t) => t.onePerPair || t.parent).map((t) => t.key));
    const writer = changesetWriter(baseUrl, prefix);
    const idMap = new Map();
    let entityCount = 0;
    for (const [typeKey, entities] of Object.entries(data.entities || {})) {
      const operation = withIdentity.has(typeKey) ? 'put_entity' : 'create_entity';
      for (const entity of entities) {
        const properties = without(entity, ENTITY_SYSTEM_FIELDS);
        await writer.add({ operation, type: typeKey, properties }, (answer) => idMap.set(entity._id, answer.id));
        entityCount++;
      }
    }
    await writer.finish();
    let relationCount = 0;
    for (const [typeKey, relations] of Object.entries(data.relations || {})) {
      const operation = onePerPair.has(typeKey) ? 'put_relation' : 'create_relation';
      for (const relation of relations) {
        const fromEntityId = idMap.get(relation.fromEntityId);
        const toEntityId = idMap.get(relation.toEntityId);
        if (!fromEntityId || !toEntityId) {
          throw new Error(`relation ${typeKey} ${relation._id} points at an entity that is not in data.json`);
        }
        const properties = without(relation, [...RELATION_SYSTEM_FIELDS, 'fromEntityId', 'toEntityId']);
        await writer.add({ operation, type: typeKey, fromEntityId, toEntityId, properties });
        relationCount++;
      }
    }
    await writer.finish();
    console.log(`  data imported: ${entityCount} entities, ${relationCount} relations in ${writer.commits} commits`);

    await waitForSearchIndices(baseUrl, key);
  } catch (err) {
    fail(`${err.message}\nOntology "${key}" is partially loaded — run: node fixtures/fixture.mjs unload ${name}`);
  }
  console.log(`Loaded fixture ${name} as ontology ${key}`);
}

async function listAll(baseUrl, path) {
  const items = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const sep = path.includes('?') ? '&' : '?';
    const page = await request(baseUrl, 'GET', `${path}${sep}limit=${PAGE_SIZE}&offset=${offset}`);
    items.push(...page.items);
    if (items.length >= page.total || page.items.length < PAGE_SIZE) return items;
  }
}

async function save({ name, key, baseUrl, dir }) {
  let schema;
  try {
    schema = await request(baseUrl, 'GET', `/api/ontologies/${key}/model/export`);
  } catch (err) {
    if (err.status === 404) fail(`fixture "${name}" is not loaded — no ontology "${key}" on ${baseUrl}`);
    fail(err.message);
  }

  try {
    const prefix = `/api/ontologies/${key}/runtime/lenses/${unscopedLensKey(schema)}`;
    const entities = {};
    for (const type of schema.entityTypes || []) {
      // The list returns document properties as stubs unless they are
      // requested by name; `fields` then limits the answer, so it lists
      // every property plus the system fields the data file carries.
      let path = `${prefix}/entities/${type.key}`;
      const props = type.properties || [];
      if (props.some((p) => p.dataType === 'document')) {
        const fields = ['_entityTypeKey', '_createdAt', '_updatedAt', ...props.map((p) => p.key)];
        path += `?${fields.map((f) => `fields=${encodeURIComponent(f)}`).join('&')}`;
      }
      const items = await listAll(baseUrl, path);
      if (items.length) entities[type.key] = items;
    }
    const relations = {};
    for (const type of schema.relationTypes || []) {
      const items = await listAll(baseUrl, `${prefix}/relations/${type.key}`);
      if (items.length) relations[type.key] = items;
    }

    mkdirSync(dir, { recursive: true });
    writeJson(join(dir, 'schema.json'), schema);
    writeJson(join(dir, 'data.json'), {
      formatVersion: '1.0',
      exportedAt: new Date().toISOString(),
      entities,
      relations,
    });
    const count = (groups) => Object.values(groups).reduce((n, list) => n + list.length, 0);
    console.log(`Saved fixture ${name}: ${count(entities)} entities, ${count(relations)} relations -> ${dir}`);
  } catch (err) {
    fail(err.message);
  }
}

async function unload({ name, key, baseUrl, dir }) {
  if (!existsSync(dir)) {
    fail(`no fixture folder ${dir} — unload only deletes ontologies of registered fixtures`);
  }
  try {
    await request(baseUrl, 'DELETE', `/api/ontologies/${key}`);
  } catch (err) {
    if (err.status === 404) fail(`fixture "${name}" is not loaded — no ontology "${key}" on ${baseUrl}`);
    fail(err.message);
  }
  console.log(`Unloaded fixture ${name} (deleted ontology ${key})`);
}

const args = parseArgs(process.argv.slice(2));
await { load, save, unload }[args.command](args);
