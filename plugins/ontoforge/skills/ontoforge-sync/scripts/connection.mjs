// Which OntoForge server these scripts talk to, and with which token. Every
// request goes through here. Identical copy in each skill's scripts/ directory
// of this plugin — change them together. The contract is ../../../CONNECTION.md.
//
// Base URL, first match wins:
//   1. the script's --base-url flag, where it has one
//   2. ONTOFORGE_BASE_URL in the file ONTOFORGE_ENV_FILE names
//   3. the ONTOFORGE_BASE_URL environment variable
//   4. http://localhost:8000 — the local server of the Docker Compose setup
// Token, only when authentication is enabled on the server, first match wins:
//   1. ONTOFORGE_API_TOKEN in the file ONTOFORGE_ENV_FILE names, or the whole
//      file when it holds nothing but the token
//   2. the ONTOFORGE_API_TOKEN environment variable
// Without a token, requests go out without `Authorization`. The token lives
// only in this process: it is sent only to the base URL (redirects are refused
// while a token is set) and never printed.

import { readFileSync } from 'node:fs';

export const DEFAULT_BASE_URL = 'http://localhost:8000';

const TOKEN_HELP =
  'Set ONTOFORGE_API_TOKEN in the environment the assistant runs in, or set ' +
  'ONTOFORGE_ENV_FILE to the path of a file holding it.';

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$|\.localhost$/;

let profile;
let tokenResolved;
const announced = new Set();

function unquote(value) {
  const quoted = value.match(/^(["'])(.*)\1(\s+#.*)?$/);
  return quoted ? quoted[2] : value.replace(/\s+#.*$/, '');
}

// The file ONTOFORGE_ENV_FILE names, read once. Only ONTOFORGE_BASE_URL and
// ONTOFORGE_API_TOKEN are taken from it. Error messages name the file, never
// its content.
function readProfile() {
  if (profile) return profile;
  const path = process.env.ONTOFORGE_ENV_FILE;
  profile = { path, vars: {} };
  if (!path) return profile;
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(`cannot read ONTOFORGE_ENV_FILE ${path}: ${err.code ?? 'read error'}`);
  }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?(ONTOFORGE_BASE_URL|ONTOFORGE_API_TOKEN)\s*=\s*(.*?)\s*$/);
    if (m && unquote(m[2])) profile.vars[m[1]] = unquote(m[2]);
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!Object.keys(profile.vars).length && lines.length === 1 && !lines[0].includes('=')) {
    profile.vars.ONTOFORGE_API_TOKEN = lines[0];
  }
  if (!Object.keys(profile.vars).length) {
    throw new Error(
      `ONTOFORGE_ENV_FILE ${path} holds neither ONTOFORGE_BASE_URL nor ONTOFORGE_API_TOKEN.`,
    );
  }
  return profile;
}

/**
 * The server to talk to, without a trailing slash. `flag` is the script's own
 * --base-url value, if it has one. Prints the server and where it came from on
 * first use, so a remote target is never a surprise.
 */
export function resolveBaseUrl(flag) {
  const { path, vars } = readProfile();
  const [url, source] = flag
    ? [flag, '--base-url']
    : vars.ONTOFORGE_BASE_URL
      ? [vars.ONTOFORGE_BASE_URL, `ONTOFORGE_ENV_FILE (${path})`]
      : process.env.ONTOFORGE_BASE_URL
        ? [process.env.ONTOFORGE_BASE_URL, 'ONTOFORGE_BASE_URL']
        : [DEFAULT_BASE_URL, 'default, the local server'];
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`invalid base URL "${url}" (from ${source})`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`base URL must be http or https: "${url}" (from ${source})`);
  }
  const baseUrl = url.replace(/\/+$/, '');
  if (!announced.has(baseUrl)) {
    announced.add(baseUrl);
    console.error(`Server: ${baseUrl} (from ${source})`);
  }
  return baseUrl;
}

function resolveToken() {
  if (tokenResolved) return tokenResolved;
  const { path, vars } = readProfile();
  if (vars.ONTOFORGE_API_TOKEN) {
    tokenResolved = { token: vars.ONTOFORGE_API_TOKEN, source: `ONTOFORGE_ENV_FILE (${path})` };
  } else if (process.env.ONTOFORGE_API_TOKEN?.trim()) {
    tokenResolved = { token: process.env.ONTOFORGE_API_TOKEN.trim(), source: 'ONTOFORGE_API_TOKEN' };
  } else {
    tokenResolved = { token: null, source: null };
  }
  if (tokenResolved.source) console.error(`Token: from ${tokenResolved.source}`);
  return tokenResolved;
}

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
    throw new Error(
      `Cannot connect to ${baseUrl}. ` +
        (baseUrl === DEFAULT_BASE_URL
          ? 'Is the local OntoForge server running? For a remote server, set ONTOFORGE_BASE_URL.'
          : 'Is the address right and the server reachable?'),
    );
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
