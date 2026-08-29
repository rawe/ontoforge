// Shared utilities for OntoForge CLI scripts.
// Requires Node.js 18+ (built-in fetch, no external dependencies).

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

/**
 * Pick an ontology key for full data access from a schema export payload.
 * Prefers unscoped ontologies (includes === null).
 */
export function pickOntologyKey(schemaPayload) {
  const ontologies = schemaPayload.lenses || [];
  if (!ontologies.length) return null;
  const unscoped = ontologies.find((o) => !o.includes);
  return unscoped ? unscoped.key : ontologies[0].key;
}

export function die(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}
