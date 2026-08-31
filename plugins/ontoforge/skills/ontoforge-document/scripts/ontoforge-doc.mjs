#!/usr/bin/env node
// Upload a file into a document property of an OntoForge entity, and download it
// back out. Requires Node.js 18+ (built-in fetch, no external dependencies).
//
// No frontmatter, no schema mapping, no config file: the file content is the
// document content, byte for byte. The script knows no ontology and no entity
// type — it takes both as arguments.
//
//   node ontoforge-doc.mjs upload   <file> --type <key> (--id <uuid> | --where <field>=<value>) [--property <field>]
//   node ontoforge-doc.mjs download <file> --type <key> (--id <uuid> | --where <field>=<value>) [--property <field>]
//
// Server from ONTOFORGE_BASE_URL (default http://localhost:8000), ontology and
// lens from --ontology/--lens or ONTOFORGE_ONTOLOGY/ONTOFORGE_LENS.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const VALUE_FLAGS = ['type', 'id', 'where', 'property', 'ontology', 'lens'];

const USAGE = `Usage:
  ontoforge-doc.mjs upload   <file> --type <key> (--id <uuid> | --where <field>=<value>) [--property <field>]
  ontoforge-doc.mjs download <file> --type <key> (--id <uuid> | --where <field>=<value>) [--property <field>]

Further options: --ontology <key> --lens <key>
Environment: ONTOFORGE_BASE_URL, ONTOFORGE_ONTOLOGY, ONTOFORGE_LENS`;

function die(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

/** Parse CLI arguments into value flags and positional arguments. */
function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (!VALUE_FLAGS.includes(name)) die(`unknown option: ${arg}\n\n${USAGE}`);
    const value = argv[++i];
    if (value === undefined) die(`option --${name} expects a value`);
    flags[name] = value;
  }
  return { flags, positional };
}

/**
 * Resolve the server URL and the route prefix for one ontology seen through one
 * lens. Neither the ontology nor the lens has a default, so an absent key is a
 * hard stop rather than a guess.
 */
function resolveConfig(flags) {
  const baseUrl = (
    process.env.ONTOFORGE_BASE_URL || 'http://localhost:8000'
  ).replace(/\/+$/, '');
  const ontology = flags.ontology || process.env.ONTOFORGE_ONTOLOGY;
  const lens = flags.lens || process.env.ONTOFORGE_LENS;
  if (!ontology) die('no ontology — pass --ontology <key> or set ONTOFORGE_ONTOLOGY');
  if (!lens) die('no lens — pass --lens <key> or set ONTOFORGE_LENS');
  return {
    baseUrl,
    prefix: `${baseUrl}/api/ontologies/${encodeURIComponent(ontology)}/runtime/lenses/${encodeURIComponent(lens)}`,
  };
}

/** Make an API request. Exits on connection failure or a non-2xx response. */
async function api(cfg, path, options = {}) {
  const headers = { ...options.headers };
  if (options.body) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(`${cfg.prefix}${path}`, { ...options, headers });
  } catch {
    die(`cannot connect to ${cfg.baseUrl} — is the OntoForge server running?`);
  }
  if (!res.ok) {
    die(`${options.method || 'GET'} ${path} -> ${res.status}: ${await res.text()}`);
  }
  return res.status === 204 ? null : res.json();
}

// The type is read from the schema rather than guessed: only that way can the
// document property be determined and a typo reported with a usable list.
async function fetchEntityType(cfg, key) {
  if (!key) die(`no entity type — pass --type <key>\n\n${USAGE}`);
  const types = await api(cfg, '/schema/entity-types');
  const entityType = types.find((t) => t.key === key);
  if (!entityType) {
    die(`entity type "${key}" is not visible through this lens. Available: ${types.map((t) => t.key).join(', ')}`);
  }
  return entityType;
}

function resolveDocumentProperty(entityType, requested) {
  const properties = (entityType.properties || []).filter((p) => p.dataType === 'document');
  const names = properties.map((p) => p.key).join(', ');
  if (requested) {
    if (!properties.some((p) => p.key === requested)) {
      die(`"${requested}" is not a document property of "${entityType.key}". Available: ${names || 'none'}`);
    }
    return requested;
  }
  if (properties.length === 1) return properties[0].key;
  if (properties.length === 0) die(`entity type "${entityType.key}" has no document property`);
  die(`entity type "${entityType.key}" has several document properties (${names}) — choose one with --property`);
}

async function resolveEntityId(cfg, entityType, flags) {
  if (flags.id && flags.where) die('--id and --where are mutually exclusive');
  if (flags.id) return flags.id;
  if (!flags.where) die(`no entity — pass --id <uuid> or --where <field>=<value>\n\n${USAGE}`);

  const separator = flags.where.indexOf('=');
  if (separator < 1) die(`--where expects <field>=<value>, got: ${flags.where}`);
  const field = flags.where.slice(0, separator);
  const value = flags.where.slice(separator + 1);

  const page = await api(
    cfg,
    `/entities/${encodeURIComponent(entityType.key)}` +
      `?filter.${encodeURIComponent(field)}=${encodeURIComponent(value)}&fields=_id&limit=2`,
  );
  const items = page.items || [];
  if (items.length === 0) {
    die(
      `no "${entityType.key}" entity with ${field}=${value}. ` +
        'This script creates none — entities are created in the UI, over MCP or over REST.',
    );
  }
  if (items.length > 1) {
    die(`${page.total} "${entityType.key}" entities with ${field}=${value} — ambiguous, use --id instead`);
  }
  return items[0]._id;
}

// A document value is written like any other property: a PATCH on the entity
// carrying the full string. The server does not alter it.
async function upload(cfg, file, entityType, property, id) {
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    die(`cannot read file: ${file}`);
  }
  await api(cfg, `/entities/${encodeURIComponent(entityType.key)}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ [property]: content }),
  });
  console.log(`uploaded: ${file} -> ${entityType.key}/${id}.${property} (${Buffer.byteLength(content, 'utf8')} bytes)`);
}

// Reading goes through the document endpoint: it returns the raw text, while
// ordinary entity reads return a stub only.
async function download(cfg, file, entityType, property, id) {
  const res = await api(
    cfg,
    `/entities/${encodeURIComponent(entityType.key)}/${encodeURIComponent(id)}/documents/${encodeURIComponent(property)}`,
  );
  const content = res.content ?? '';
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, 'utf8');
  console.log(`downloaded: ${entityType.key}/${id}.${property} -> ${file} (${Buffer.byteLength(content, 'utf8')} bytes)`);
}

const { flags, positional } = parseArgs(process.argv.slice(2));
const [command, file] = positional;
if (!['upload', 'download'].includes(command)) die(`unknown command: ${command ?? '(none)'}\n\n${USAGE}`);
if (!file) die(`no file\n\n${USAGE}`);
if (positional.length > 2) die(`too many arguments: ${positional.slice(2).join(', ')}\n\n${USAGE}`);

const cfg = resolveConfig(flags);
const entityType = await fetchEntityType(cfg, flags.type);
const property = resolveDocumentProperty(entityType, flags.property);
const id = await resolveEntityId(cfg, entityType, flags);

if (command === 'upload') await upload(cfg, file, entityType, property, id);
else await download(cfg, file, entityType, property, id);
