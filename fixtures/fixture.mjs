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
const ENTITY_SYSTEM_FIELDS = ['_id', '_entityTypeKey', '_createdAt', '_updatedAt'];
const RELATION_SYSTEM_FIELDS = ['_id', '_relationTypeKey', '_createdAt', '_updatedAt'];

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

// One request; returns the parsed JSON body (or the raw response when
// `raw` is set). A non-2xx answer throws with the server's own message.
async function request(baseUrl, method, path, body, { raw = false } = {}) {
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
  if (raw) return res;
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

async function rebuildSearchData(baseUrl, key) {
  const res = await request(baseUrl, 'POST', `/api/ontologies/${key}/model/rebuild-search-data`, undefined, { raw: true });
  const text = await res.text();
  const events = text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const summary = events.find((e) => e.type === 'summary');
  if (!summary) throw new Error('search data rebuild ended without a summary');
  const embeddings = summary.embeddingsSkipped ? ', embeddings skipped (no provider)' : '';
  console.log(`  search data rebuilt: ${summary.totalProcessed} processed, ${summary.totalFailed} failed${embeddings}`);
  if (summary.totalFailed) {
    console.warn('  Warning: some search data failed to build — the data is loaded; rebuild search data again once the provider works');
  }
}

async function load({ name, key, baseUrl, dir }) {
  if (!existsSync(dir)) fail(`no fixture folder ${dir}`);
  const schema = readJson(join(dir, 'schema.json'));
  const data = readJson(join(dir, 'data.json'));

  try {
    await request(baseUrl, 'POST', '/api/ontologies', {
      key,
      textSearchLanguage: schema.textSearchLanguage,
    });
  } catch (err) {
    if (err.status === 409) fail(`fixture "${name}" is already loaded as ontology "${key}" — run unload first`);
    fail(err.message);
  }
  console.log(`Created ontology ${key}`);

  try {
    await request(baseUrl, 'POST', `/api/ontologies/${key}/model/import`, schema);
    console.log('  schema imported');

    const prefix = `/api/ontologies/${key}/runtime/lenses/${unscopedLensKey(schema)}`;
    const idMap = new Map();
    let entityCount = 0;
    for (const [typeKey, entities] of Object.entries(data.entities || {})) {
      for (const entity of entities) {
        const created = await request(baseUrl, 'POST', `${prefix}/entities/${typeKey}`, without(entity, ENTITY_SYSTEM_FIELDS));
        idMap.set(entity._id, created._id);
        entityCount++;
      }
    }
    let relationCount = 0;
    for (const [typeKey, relations] of Object.entries(data.relations || {})) {
      for (const relation of relations) {
        const fromEntityId = idMap.get(relation.fromEntityId);
        const toEntityId = idMap.get(relation.toEntityId);
        if (!fromEntityId || !toEntityId) {
          throw new Error(`relation ${typeKey} ${relation._id} points at an entity that is not in data.json`);
        }
        const body = { ...without(relation, RELATION_SYSTEM_FIELDS), fromEntityId, toEntityId };
        await request(baseUrl, 'POST', `${prefix}/relations/${typeKey}`, body);
        relationCount++;
      }
    }
    console.log(`  data imported: ${entityCount} entities, ${relationCount} relations`);

    await rebuildSearchData(baseUrl, key);
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
