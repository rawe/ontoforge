// Pure conversion between OKF concept documents (Markdown + YAML frontmatter)
// and OntoForge entity payloads. No I/O, no HTTP — every function is pure so
// round-trips are testable in isolation.
//
// Supported YAML subset (flat frontmatter only, per OKF conventions):
// plain/quoted scalars, numbers, booleans, null, inline lists [a, b] and
// block lists. Nested mappings and block scalars (| >) are rejected.

/** Named in errors when the caller has no resolved path (tests, direct use). */
const CONFIG_LABEL = 'okf.config.json';

export const DEFAULT_CONFIG = {
  ontology: null, // required: the ontology key the bundle syncs with
  lens: null, // required: the lens its instance data is read and written through
  conceptIdProperty: 'concept_id',
  documentProperty: null, // null = auto-detect the single document property
  typeMap: {}, // required: frontmatter type value -> entity type key, one-to-one
  listProperties: ['tags'], // string properties serialized as YAML lists
  listDelimiter: ', ',
};

export function mergeConfig(raw = {}) {
  const config = { ...DEFAULT_CONFIG, ...raw };
  config.typeMap = { ...(raw.typeMap || {}) };
  config.listProperties = raw.listProperties || [...DEFAULT_CONFIG.listProperties];
  validateConfig(config);
  return config;
}

/**
 * Reject a config that cannot produce a stable mapping, naming every fault at
 * once. `typeMap` must be one-to-one because the pull reverses it to recover
 * the frontmatter `type` value.
 */
function validateConfig(config) {
  const errors = [];
  if (!config.ontology) {
    errors.push('"ontology" is missing — name the ontology key this bundle syncs with');
  }
  if (!config.lens) {
    errors.push(
      '"lens" is missing — name the lens the bundle\'s entities are read and written through',
    );
  }
  const entries = Object.entries(config.typeMap);
  if (!entries.length) {
    errors.push('"typeMap" is empty — every OKF type value needs an entity type key');
  }
  const seen = new Map();
  for (const [typeValue, entityTypeKey] of entries) {
    const first = seen.get(entityTypeKey);
    if (first !== undefined) {
      errors.push(
        `"typeMap" maps both "${first}" and "${typeValue}" to "${entityTypeKey}" — entity type keys must be distinct`,
      );
    } else {
      seen.set(entityTypeKey, typeValue);
    }
  }
  if (errors.length) throw new Error(`okf.config.json is invalid: ${errors.join('; ')}`);
}

/** Resolve a frontmatter type value to an entity type key. */
export function entityTypeKeyFor(typeValue, config, configPath = CONFIG_LABEL) {
  const key = config.typeMap[typeValue];
  if (!key) {
    throw new Error(
      `no "typeMap" entry for type "${typeValue}" — add it to ${configPath} (see references/setup.md)`,
    );
  }
  return key;
}

/** Recover the frontmatter type value for an entity type key. */
export function typeValueFor(entityTypeKey, config) {
  const entry = Object.entries(config.typeMap).find(([, v]) => v === entityTypeKey);
  if (!entry) {
    throw new Error(`no "typeMap" entry maps to entity type "${entityTypeKey}"`);
  }
  return entry[0];
}

const RESERVED_BASENAMES = new Set(['index', 'log']);

// --- Concept IDs ---

export function conceptIdFromPath(relPath) {
  const posix = relPath.split(/[\\/]/).filter(Boolean).join('/');
  if (!posix.toLowerCase().endsWith('.md')) {
    throw new Error(`not a Markdown file: ${relPath}`);
  }
  if (posix.startsWith('../') || posix === '..') {
    throw new Error(`file is outside the bundle root: ${relPath}`);
  }
  const conceptId = posix.slice(0, -3);
  const basename = conceptId.split('/').pop();
  if (RESERVED_BASENAMES.has(basename)) {
    throw new Error(`"${basename}.md" is a reserved OKF filename, not a concept document`);
  }
  return conceptId;
}

// --- Frontmatter parsing ---

export function parseConceptDocument(mdText) {
  const text = mdText.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  if (lines[0] !== '---') {
    throw new Error('missing YAML frontmatter (an OKF concept document must start with "---")');
  }
  const closing = lines.indexOf('---', 1);
  if (closing === -1) {
    throw new Error('unterminated YAML frontmatter (no closing "---")');
  }
  const fields = parseYamlBlock(lines.slice(1, closing));
  const body = lines
    .slice(closing + 1)
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
  return { fields, body };
}

function parseYamlBlock(lines) {
  const fields = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) {
      i += 1;
      continue;
    }
    if (/^\s/.test(line)) {
      throw new Error(`unexpected indentation in frontmatter at "${line.trim()}" (nested mappings are not supported)`);
    }
    const match = line.match(/^([A-Za-z0-9_][A-Za-z0-9_.-]*):(.*)$/);
    if (!match) {
      throw new Error(`cannot parse frontmatter line: "${line}"`);
    }
    const key = match[1];
    const rest = match[2].trim();
    if (rest === '') {
      const items = [];
      let j = i + 1;
      while (j < lines.length && /^\s*-\s/.test(lines[j])) {
        items.push(parseScalar(lines[j].replace(/^\s*-\s*/, '').trim()));
        j += 1;
      }
      fields[key] = items.length ? items : null;
      i = items.length ? j : i + 1;
      continue;
    }
    if (rest.startsWith('|') || rest.startsWith('>')) {
      throw new Error(`block scalars (| and >) are not supported (key "${key}")`);
    }
    fields[key] = rest.startsWith('[') ? parseInlineList(rest) : parseScalar(rest);
    i += 1;
  }
  return fields;
}

function parseScalar(raw) {
  if (raw.startsWith('"')) {
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error(`invalid double-quoted scalar: ${raw}`);
    }
  }
  if (raw.startsWith("'")) {
    if (raw.length < 2 || !raw.endsWith("'")) {
      throw new Error(`invalid single-quoted scalar: ${raw}`);
    }
    return raw.slice(1, -1).replace(/''/g, "'");
  }
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null' || raw === '~') return null;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  if (/^-?\d*\.\d+$/.test(raw)) return Number(raw);
  return raw;
}

function parseInlineList(raw) {
  if (!raw.endsWith(']')) {
    throw new Error(`unterminated inline list: ${raw}`);
  }
  const inner = raw.slice(1, -1).trim();
  if (!inner) return [];
  const items = [];
  let current = '';
  let quote = null;
  for (const ch of inner) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ',') {
      items.push(parseScalar(current.trim()));
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) items.push(parseScalar(current.trim()));
  return items;
}

// --- Frontmatter serialization ---

/** Keys are written in alphabetical order, so repeated pulls are byte-identical. */
export function serializeFrontmatter(fields) {
  const lines = [];
  for (const key of Object.keys(fields).sort()) {
    const value = fields[key];
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      if (!value.length) continue;
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${serializeScalar(item)}`);
    } else {
      lines.push(`${key}: ${serializeScalar(value)}`);
    }
  }
  return lines.join('\n');
}

const PLAIN_SCALAR = /^[A-Za-z0-9][A-Za-z0-9 _/.,;()+&-]*$/;

function serializeScalar(value) {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const s = String(value);
  const looksLikeOtherType =
    ['true', 'false', 'null', '~'].includes(s) || /^-?\d+$/.test(s) || /^-?\d*\.\d+$/.test(s);
  if (PLAIN_SCALAR.test(s) && !/\s$/.test(s) && !looksLikeOtherType) return s;
  return JSON.stringify(s);
}

// --- Entity mapping ---

export function resolveDocumentProperty(entityType, config) {
  if (config.documentProperty) {
    const def = (entityType.properties || []).find((p) => p.key === config.documentProperty);
    if (!def || def.dataType !== 'document') {
      throw new Error(
        `configured documentProperty "${config.documentProperty}" is not a document property of entity type "${entityType.key}"`,
      );
    }
    return def.key;
  }
  const docProps = (entityType.properties || []).filter((p) => p.dataType === 'document');
  if (docProps.length === 1) return docProps[0].key;
  if (docProps.length === 0) {
    throw new Error(`entity type "${entityType.key}" has no document property — OKF concepts need one for the Markdown body`);
  }
  throw new Error(
    `entity type "${entityType.key}" has ${docProps.length} document properties — set "documentProperty" in okf.config.json`,
  );
}

/**
 * Map a parsed concept document to an OntoForge entity payload.
 * Returns { payload, unknownKeys, documentProperty } — unknownKeys are
 * frontmatter keys with no matching property definition (the caller decides
 * whether to fail or skip them).
 */
export function toEntityPayload(doc, conceptId, entityType, config) {
  const props = new Map((entityType.properties || []).map((p) => [p.key, p]));
  const conceptProp = config.conceptIdProperty;
  if (!props.has(conceptProp)) {
    throw new Error(
      `entity type "${entityType.key}" has no "${conceptProp}" property — add it (string, required) to use OKF sync`,
    );
  }
  const documentProperty = resolveDocumentProperty(entityType, config);
  const payload = { [conceptProp]: conceptId, [documentProperty]: `${doc.body}\n` };
  const unknownKeys = [];
  for (const [key, value] of Object.entries(doc.fields)) {
    if (key === 'type' || value === null || value === undefined) continue;
    const def = props.get(key);
    if (!def) {
      unknownKeys.push(key);
      continue;
    }
    if (def.key === conceptProp || def.key === documentProperty) {
      throw new Error(
        `frontmatter key "${key}" collides with the ${def.key === conceptProp ? 'concept-ID' : 'document'} property`,
      );
    }
    payload[key] = coerceValue(value, def, config);
  }
  return { payload, unknownKeys, documentProperty };
}

function coerceValue(value, def, config) {
  if (Array.isArray(value)) {
    if (def.dataType !== 'string') {
      throw new Error(`property "${def.key}" is ${def.dataType}; YAML lists are only supported for string properties`);
    }
    return value.map(String).join(config.listDelimiter);
  }
  switch (def.dataType) {
    case 'integer': {
      const n = Number(value);
      if (!Number.isInteger(n)) throw new Error(`property "${def.key}" expects an integer, got: ${value}`);
      return n;
    }
    case 'float': {
      const n = Number(value);
      if (Number.isNaN(n)) throw new Error(`property "${def.key}" expects a number, got: ${value}`);
      return n;
    }
    case 'boolean':
      if (typeof value !== 'boolean') throw new Error(`property "${def.key}" expects true/false, got: ${value}`);
      return value;
    case 'document':
      throw new Error(`property "${def.key}" is a document property and cannot be set from frontmatter`);
    default:
      return String(value); // string, date, datetime
  }
}

/**
 * Render an OntoForge entity as an OKF concept document.
 * The entity must carry raw property values (document properties fetched via
 * a fields projection, not as stubs).
 */
export function fromEntity(entity, entityType, config, typeValue) {
  const documentProperty = resolveDocumentProperty(entityType, config);
  const body = entity[documentProperty];
  if (body !== null && body !== undefined && typeof body === 'object') {
    throw new Error(
      `document property "${documentProperty}" was returned as a stub — fetch the entity with a fields projection`,
    );
  }
  const fields = { type: typeValue };
  for (const def of entityType.properties || []) {
    if (def.key === documentProperty || def.key === config.conceptIdProperty) continue;
    if (def.dataType === 'document') continue; // additional document properties have no OKF representation
    let value = entity[def.key];
    if (value === null || value === undefined) continue;
    if (config.listProperties.includes(def.key) && typeof value === 'string') {
      value = value
        .split(config.listDelimiter.trim() || ',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    fields[def.key] = value;
  }
  const frontmatter = serializeFrontmatter(fields);
  const normalizedBody = String(body ?? '')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
  return `---\n${frontmatter}\n---\n\n${normalizedBody}\n`;
}
