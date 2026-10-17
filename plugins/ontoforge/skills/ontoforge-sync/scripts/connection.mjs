// Every request these scripts send to an OntoForge server goes through here.
// Identical copy in each skill's scripts/ directory of this plugin — change
// them together.
//
// When authentication is enabled on the server, every request needs
// `Authorization: Bearer <token>`. The token is optional and comes from, in
// this order:
//   1. the file ONTOFORGE_ENV_FILE names — a KEY=value file holding an
//      ONTOFORGE_API_TOKEN line, or a file holding only the token
//   2. the ONTOFORGE_API_TOKEN environment variable
// Without either, requests go out without the header. The token lives only in
// this process: it is sent only to the base URL (redirects are refused while a
// token is set) and never printed.

import { readFileSync } from 'node:fs';

const TOKEN_HELP =
  'Set ONTOFORGE_API_TOKEN in the environment the assistant runs in, or set ' +
  'ONTOFORGE_ENV_FILE to the path of a file holding it.';

let resolved;

function unquote(value) {
  const quoted = value.match(/^(["'])(.*)\1(\s+#.*)?$/);
  return quoted ? quoted[2] : value.replace(/\s+#.*$/, '');
}

// Reads only ONTOFORGE_API_TOKEN. Error messages name the file, never its content.
function readTokenFile(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(`cannot read ONTOFORGE_ENV_FILE ${path}: ${err.code ?? 'read error'}`);
  }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?ONTOFORGE_API_TOKEN\s*=\s*(.*?)\s*$/);
    if (m && unquote(m[1])) return unquote(m[1]);
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 1 && !lines[0].includes('=')) return lines[0];
  throw new Error(`ONTOFORGE_ENV_FILE ${path} holds no ONTOFORGE_API_TOKEN line. ${TOKEN_HELP}`);
}

function resolveToken() {
  if (resolved) return resolved;
  const file = process.env.ONTOFORGE_ENV_FILE;
  if (file) {
    resolved = { token: readTokenFile(file), source: `ONTOFORGE_ENV_FILE (${file})` };
  } else if (process.env.ONTOFORGE_API_TOKEN?.trim()) {
    resolved = { token: process.env.ONTOFORGE_API_TOKEN.trim(), source: 'ONTOFORGE_API_TOKEN' };
  } else {
    resolved = { token: null, source: null };
  }
  if (resolved.source) console.error(`Token: from ${resolved.source}`);
  return resolved;
}

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$|\.localhost$/;
const warned = new Set();

/**
 * fetch() against the server at baseUrl, with the Bearer token when one is
 * configured. Answers the Response as fetch does; a 401 or 403 becomes an
 * error that says where the token comes from.
 */
export async function serverFetch(baseUrl, path, init = {}) {
  const { token } = resolveToken();
  const headers = { ...init.headers };
  if (token) {
    const url = new URL(baseUrl);
    if (url.protocol === 'http:' && !LOCAL_HOST.test(url.hostname) && !warned.has(url.host)) {
      warned.add(url.host);
      console.error(`Warning: sending the token over plain http to ${url.host}`);
    }
    headers.Authorization = `Bearer ${token}`;
  }
  let res;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
      ...(token ? { redirect: 'manual' } : {}),
    });
  } catch {
    throw new Error(`Cannot connect to ${baseUrl}. Is the OntoForge server running?`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `${init.method || 'GET'} ${path} -> ${res.status}: ` +
        (token
          ? `${baseUrl} rejected the token. Check that it is the one for this server.`
          : `${baseUrl} has authentication enabled and needs a Bearer token. ${TOKEN_HELP}`),
    );
  }
  if (token && res.status >= 300 && res.status < 400) {
    throw new Error(
      `${init.method || 'GET'} ${path} -> ${res.status} redirect refused, so the token stays ` +
        `with ${baseUrl}. Use the address it redirects to as the base URL.`,
    );
  }
  return res;
}
