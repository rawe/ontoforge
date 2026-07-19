// Shared utilities for the OntoForge OKF scripts.
// Requires Node.js 18+ (built-in fetch, no external dependencies).

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { mergeConfig } from './codec.mjs';

export const CONFIG_FILENAME = 'okf.config.json';

/**
 * Parse CLI arguments.
 * @param {Object<string, string[]>} flagDefs - Value flags: name to aliases
 * @param {Object<string, string[]>} boolDefs - Boolean flags: name to aliases
 * @returns {{ flags: Object<string, string|boolean>, positional: string[] }}
 */
export function parseCliArgs(flagDefs = {}, boolDefs = {}) {
  const raw = process.argv.slice(2);
  const flags = {};
  const positional = [];
  const valueAliases = new Map();
  const boolAliases = new Map();
  for (const [name, alts] of Object.entries(flagDefs)) {
    for (const alt of alts) valueAliases.set(alt, name);
  }
  for (const [name, alts] of Object.entries(boolDefs)) {
    for (const alt of alts) boolAliases.set(alt, name);
  }
  for (let i = 0; i < raw.length; i++) {
    if (valueAliases.has(raw[i])) {
      flags[valueAliases.get(raw[i])] = raw[++i];
    } else if (boolAliases.has(raw[i])) {
      flags[boolAliases.get(raw[i])] = true;
    } else if (!raw[i].startsWith('-')) {
      positional.push(raw[i]);
    }
  }
  return { flags, positional };
}

/**
 * Resolve the OntoForge server base URL.
 * Priority: --base-url flag > ONTOFORGE_BASE_URL env > http://localhost:8000
 */
export function getBaseUrl(flags) {
  const url =
    flags.baseUrl || process.env.ONTOFORGE_BASE_URL || 'http://localhost:8000';
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
 * Locate the bundle root and mapping config.
 * The bundle root is: --root flag > directory of the config file > cwd.
 * The config file is: --config flag > nearest okf.config.json walking up
 * from startDir > none (defaults apply).
 * @returns {{ config: object, root: string, configPath: string|null }}
 */
export function resolveBundleContext(startDir, flags) {
  let configPath = null;
  let configDir = null;
  if (flags.config) {
    configPath = resolve(flags.config);
    if (!existsSync(configPath)) {
      throw new Error(`config file not found: ${flags.config}`);
    }
    configDir = dirname(configPath);
  } else {
    let dir = resolve(startDir);
    for (;;) {
      const candidate = join(dir, CONFIG_FILENAME);
      if (existsSync(candidate)) {
        configPath = candidate;
        configDir = dir;
        break;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  let rawConfig = {};
  if (configPath) {
    try {
      rawConfig = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch (err) {
      throw new Error(`cannot parse ${configPath}: ${err.message}`);
    }
  }
  const root = flags.root ? resolve(flags.root) : configDir || process.cwd();
  return { config: mergeConfig(rawConfig), root, configPath };
}

/**
 * Resolve the ontology key: --ontology flag > config file > error.
 */
export function requireOntology(flags, config) {
  const key = flags.ontology || config.ontology;
  if (!key) {
    throw new Error(
      'no ontology key — pass --ontology <key> or set "ontology" in okf.config.json',
    );
  }
  return key;
}

/**
 * Find entity IDs matching a property value (exact filter match).
 * Returns the matching IDs (at most 2 — enough to detect ambiguity).
 */
export async function findEntityIds(baseUrl, ontologyKey, entityTypeKey, propertyKey, value) {
  const path =
    `/api/runtime/${encodeURIComponent(ontologyKey)}/entities/${encodeURIComponent(entityTypeKey)}` +
    `?filter.${encodeURIComponent(propertyKey)}=${encodeURIComponent(value)}&limit=2&fields=_id`;
  const page = await api(baseUrl, path);
  return page.items.map((item) => item._id);
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
