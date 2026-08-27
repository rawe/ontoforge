// Shared utilities for the OntoForge OKF scripts.
// Requires Node.js 18+ (built-in fetch, no external dependencies).

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { mergeConfig } from './codec.mjs';

export const CONFIG_FILENAME = 'okf.config.json';

/**
 * Parse CLI arguments.
 * @param {Object<string, string[]>} boolDefs - Boolean flags: name to aliases
 * @returns {{ flags: Object<string, boolean>, positional: string[] }}
 */
export function parseCliArgs(boolDefs = {}) {
  const raw = process.argv.slice(2);
  const flags = {};
  const positional = [];
  const boolAliases = new Map();
  for (const [name, alts] of Object.entries(boolDefs)) {
    for (const alt of alts) boolAliases.set(alt, name);
  }
  for (const arg of raw) {
    if (boolAliases.has(arg)) {
      flags[boolAliases.get(arg)] = true;
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

/** The OntoForge server URL. Per-developer, so it never lives in the bundle. */
export function getBaseUrl() {
  const url = process.env.ONTOFORGE_BASE_URL;
  if (!url) {
    throw new Error('ONTOFORGE_BASE_URL is not set — point it at your OntoForge server');
  }
  return url.replace(/\/+$/, '');
}

/**
 * Make an API request. Throws on non-2xx responses.
 */
export async function api(baseUrl, path, options = {}) {
  const url = `${baseUrl}${path}`;
  const headers = { ...options.headers };
  if (options.body) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(url, { ...options, headers });
  } catch {
    throw new Error(
      `Cannot connect to ${baseUrl}. Is the OntoForge server running?`,
    );
  }
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
 * Load the bundle config. The directory holding okf.config.json IS the bundle
 * root — concept IDs are file paths relative to it, so there is no other way
 * to name it.
 * @returns {{ config: object, root: string, configPath: string }}
 */
export function resolveBundleContext(startDir) {
  let dir = resolve(startDir);
  let configPath = null;
  for (;;) {
    const candidate = join(dir, CONFIG_FILENAME);
    if (existsSync(candidate)) {
      configPath = candidate;
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (!configPath) {
    throw new Error(
      `no ${CONFIG_FILENAME} found in ${resolve(startDir)} or any parent — see references/setup.md to create one`,
    );
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (err) {
    throw new Error(`cannot parse ${configPath}: ${err.message}`);
  }
  let config;
  try {
    config = mergeConfig(raw);
  } catch (err) {
    // mergeConfig is pure and cannot know which file it came from.
    throw new Error(err.message.replace(/^okf\.config\.json/, configPath));
  }
  return { config, root: dir, configPath };
}

/**
 * Fetch the entity types the config maps to, keyed by entity type key.
 * A mapped type missing from the ontology is a config error, reported with
 * every offender at once.
 * @returns {Promise<Map<string, object>>}
 */
export async function loadMappedTypes(baseUrl, ontologyKey, config, configPath) {
  const all = await api(
    baseUrl,
    `/api/runtime/${encodeURIComponent(ontologyKey)}/schema/entity-types`,
  );
  const byKey = new Map(all.map((et) => [et.key, et]));
  const mapped = new Map();
  const missing = [];
  for (const entityTypeKey of Object.values(config.typeMap)) {
    const entityType = byKey.get(entityTypeKey);
    if (entityType) mapped.set(entityTypeKey, entityType);
    else missing.push(entityTypeKey);
  }
  if (missing.length) {
    throw new Error(
      `ontology "${ontologyKey}" has no entity type ${missing.map((k) => `"${k}"`).join(', ')} ` +
        `— create ${missing.length > 1 ? 'them' : 'it'} or correct "typeMap" in ${configPath} ` +
        '(see references/setup.md)',
    );
  }
  return mapped;
}

/**
 * Find every entity carrying this concept ID, across all mapped entity types.
 * The concept ID alone is the identity of a document, so both push and pull
 * resolve it the same way.
 * @returns {Promise<Array<{ entityTypeKey: string, id: string }>>}
 */
export async function findByConceptId(baseUrl, ontologyKey, config, mappedTypes, conceptId) {
  const matches = [];
  for (const entityTypeKey of mappedTypes.keys()) {
    const path =
      `/api/runtime/${encodeURIComponent(ontologyKey)}/entities/${encodeURIComponent(entityTypeKey)}` +
      `?filter.${encodeURIComponent(config.conceptIdProperty)}=${encodeURIComponent(conceptId)}&limit=2&fields=_id`;
    const page = await api(baseUrl, path);
    for (const item of page.items) matches.push({ entityTypeKey, id: item._id });
  }
  return matches;
}

/**
 * Fetch an entity with raw property values (document properties included,
 * not stubs) by projecting every declared property.
 */
export async function fetchEntityRaw(baseUrl, ontologyKey, entityType, entityId) {
  const fields = (entityType.properties || []).map((p) => p.key);
  const query = fields.map((f) => `fields=${encodeURIComponent(f)}`).join('&');
  const path =
    `/api/runtime/${encodeURIComponent(ontologyKey)}/entities/${encodeURIComponent(entityType.key)}` +
    `/${encodeURIComponent(entityId)}?${query}`;
  return api(baseUrl, path);
}

export function die(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}
