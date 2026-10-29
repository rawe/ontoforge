// Shared helpers for the authentication checks (e2e.mjs, scripts/scale/scenarios.mjs): a
// cookie jar, the Keycloak sign-in form driven without a browser, tokens of the development
// realm's test users and service client, a browser-style sign-in to OntoForge, an HTTP call
// with a cookie or a token, and an MCP client that authorizes itself through Keycloak.
// Node 22; the MCP client comes from the server's installed SDK. Secrets come from
// env/keycloak.local.env (./dev.sh keycloak) and are never printed.
//
//   node scripts/auth/lib.mjs --self-check     tokens from the running Keycloak, claims only

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const KEYCLOAK_URL = 'http://localhost:8180';
export const ISSUER = `${KEYCLOAK_URL}/realms/ontoforge`;
export const AUDIENCE = 'ontoforge-api';
const SDK = join(ROOT, 'server', 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'esm');

// --- Secrets -----------------------------------------------------------------

function readEnvFile(file) {
  const values = {};
  if (!existsSync(file)) return values;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) values[match[1]] = match[2];
  }
  return values;
}

let secretValues = null;

/** One value of env/keycloak.local.env; throws naming the variable, never the value. */
export function secret(name) {
  secretValues ??= readEnvFile(join(ROOT, 'env', 'keycloak.local.env'));
  const value = secretValues[name];
  if (!value) throw new Error(`${name} missing from env/keycloak.local.env — run ./dev.sh keycloak`);
  return value;
}

/** A Keycloak subject (`admin`, `reader`, …, `service`) from env/keycloak-subjects.local.env. */
export function subject(name) {
  const value = readEnvFile(join(ROOT, 'env', 'keycloak-subjects.local.env'))[`SUBJECT_${name.toUpperCase()}`];
  if (!value) throw new Error(`SUBJECT_${name.toUpperCase()} missing from env/keycloak-subjects.local.env — run ./dev.sh keycloak`);
  return value;
}

const passwordOf = (username) => secret(`USER_${username.toUpperCase()}_PASSWORD`);

// --- Cookies -----------------------------------------------------------------

/**
 * Cookies by host name, as a browser keeps them: ports do not separate cookies (OntoForge
 * names its session cookie after WEB_CLIENT_URL's port for that reason), paths do.
 */
export class CookieJar {
  constructor() { this.hosts = new Map(); }

  /** Takes the Set-Cookie headers of a response to `url`. */
  store(url, response) {
    const host = new URL(url).hostname;
    const cookies = this.hosts.get(host) ?? new Map();
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(';').map((s) => s.trim());
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      const attr = Object.fromEntries(attributes.map((a) => {
        const i = a.indexOf('=');
        return i < 0 ? [a.toLowerCase(), true] : [a.slice(0, i).toLowerCase(), a.slice(i + 1)];
      }));
      const path = typeof attr.path === 'string' ? attr.path : '/';
      const expired = attr['max-age'] !== undefined
        ? Number(attr['max-age']) <= 0
        : typeof attr.expires === 'string' && Date.parse(attr.expires) <= Date.now();
      const key = `${name}\u0000${path}`;
      if (expired || value === '') cookies.delete(key);
      else cookies.set(key, { name, value, path });
    }
    this.hosts.set(host, cookies);
  }

  /** The Cookie header for a request to `url`, or undefined. */
  header(url) {
    const { hostname, pathname } = new URL(url);
    const matching = [...(this.hosts.get(hostname)?.values() ?? [])]
      .filter((c) => pathname === c.path || pathname.startsWith(c.path.endsWith('/') ? c.path : `${c.path}/`));
    return matching.length ? matching.map((c) => `${c.name}=${c.value}`).join('; ') : undefined;
  }

  /** Names of the cookies held for a host (evidence without values). */
  names(url) {
    return [...(this.hosts.get(new URL(url).hostname)?.values() ?? [])].map((c) => c.name);
  }
}

/** One request without following redirects; the jar sends and keeps cookies. */
async function send(url, { method = 'GET', headers = {}, body, jar } = {}) {
  const cookie = jar?.header(url);
  const response = await fetch(url, {
    method,
    headers: { ...headers, ...(cookie ? { cookie } : {}) },
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  });
  jar?.store(url, response);
  return response;
}

// --- Keycloak sign-in form -----------------------------------------------------

const decodeHtml = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** The first <form> of a page matching `test` (its tag and its content): action and hidden inputs. */
function parseForm(html, test) {
  const forms = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)];
  const form = forms.find((f) => test.test(f[0]));
  if (!form) return null;
  const action = /action="([^"]*)"/i.exec(form[1])?.[1];
  const fields = {};
  for (const input of form[2].matchAll(/<input\b([^>]*)>/gi)) {
    const name = /name="([^"]*)"/i.exec(input[1])?.[1];
    const type = /type="([^"]*)"/i.exec(input[1])?.[1] ?? 'text';
    if (name && type === 'hidden') fields[name] = decodeHtml(/value="([^"]*)"/i.exec(input[1])?.[1] ?? '');
  }
  return { action: action && decodeHtml(action), fields };
}

/** Keycloak's message on a page that is neither the form nor a redirect, for the error. */
function pageMessage(html) {
  const text = (re) => re.exec(html)?.[1]?.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return text(/id="input-error[^"]*"[^>]*>([\s\S]*?)<\/span>/i)
    ?? text(/class="[^"]*(?:kc-feedback-text|pf-v5-c-alert__title|instruction)[^"]*"[^>]*>([\s\S]*?)<\/(?:span|h4|p)>/i)
    ?? text(/<title>([\s\S]*?)<\/title>/i)
    ?? 'unrecognised page';
}

/**
 * Signs `username` in at Keycloak the way a browser would: starts at `startUrl` (the app's
 * /api/auth/login or Keycloak's authorization URL), follows redirects by hand, submits the
 * login form, accepts a consent screen, and returns the first redirect that leaves Keycloak
 * after it was reached — e.g. `…/api/auth/callback?code=…&state=…` — without following it,
 * so the caller delivers it to the backend it chooses.
 */
export async function keycloakLogin(startUrl, username, password, jar) {
  const keycloak = new URL(ISSUER).origin;
  let url = startUrl;
  let request = { method: 'GET' };
  let reachedKeycloak = new URL(startUrl).origin === keycloak;
  for (let hop = 0; hop < 20; hop++) {
    const response = await send(url, { ...request, jar });
    if (response.status >= 300 && response.status < 400) {
      await response.arrayBuffer();
      const next = new URL(response.headers.get('location'), url).href;
      if (reachedKeycloak && new URL(next).origin !== keycloak) return next;
      if (new URL(next).origin === keycloak) reachedKeycloak = true;
      url = next;
      request = { method: 'GET' };
      continue;
    }
    const html = await response.text();
    if (response.status !== 200) throw new Error(`Keycloak sign-in of ${username}: HTTP ${response.status} at ${new URL(url).pathname} (${pageMessage(html)})`);
    const login = parseForm(html, /id="kc-form-login"/);
    const consent = parseForm(html, /name="accept"/);
    let fields;
    let action;
    if (login && request.method === 'GET') {
      ({ action } = login);
      fields = { ...login.fields, username, password, credentialId: login.fields.credentialId ?? '' };
    } else if (consent) {
      ({ action } = consent);
      fields = { ...consent.fields, accept: 'Yes' };
    } else {
      throw new Error(`Keycloak sign-in of ${username} stopped: ${pageMessage(html)}`);
    }
    url = new URL(action, url).href;
    request = {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    };
  }
  throw new Error(`Keycloak sign-in of ${username}: more than 20 redirects`);
}

// --- Tokens --------------------------------------------------------------------

let discovery = null;

/** The realm's OpenID configuration. */
export async function oidcConfiguration() {
  if (discovery) return discovery;
  const response = await fetch(`${ISSUER}/.well-known/openid-configuration`);
  if (!response.ok) throw new Error(`Keycloak discovery answered ${response.status} — is ./dev.sh keycloak running?`);
  discovery = await response.json();
  return discovery;
}

/** A free loopback port (bound and released at once). */
export function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const base64url = (buffer) => buffer.toString('base64url');

async function tokenRequest(params) {
  const { token_endpoint: endpoint } = await oidcConfiguration();
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`token endpoint answered ${response.status} ${json.error ?? ''}`.trim());
  return json;
}

/**
 * A test user's tokens from the public client `ontoforge-mcp`: authorization code + PKCE with
 * a loopback redirect, the Keycloak form driven by `keycloakLogin` (no password grant).
 * Scope `openid ontoforge-api` gives an access token for OntoForge; leave `ontoforge-api`
 * out for one with another audience.
 */
export async function userTokens(username, { scope = `openid ${AUDIENCE}` } = {}) {
  const { authorization_endpoint: endpoint } = await oidcConfiguration();
  const redirectUri = `http://127.0.0.1:${await freePort()}/callback`;
  const verifier = base64url(randomBytes(32));
  const state = base64url(randomBytes(16));
  const url = new URL(endpoint);
  url.search = new URLSearchParams({
    client_id: 'ontoforge-mcp',
    response_type: 'code',
    redirect_uri: redirectUri,
    scope,
    state,
    code_challenge: base64url(createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256',
  }).toString();
  const callback = new URL(await keycloakLogin(url.href, username, passwordOf(username), new CookieJar()));
  if (callback.searchParams.get('state') !== state) throw new Error(`sign-in of ${username} returned another state`);
  const code = callback.searchParams.get('code');
  if (!code) throw new Error(`sign-in of ${username} returned no code (${callback.searchParams.get('error') ?? 'no error'})`);
  return tokenRequest({ grant_type: 'authorization_code', client_id: 'ontoforge-mcp', code, redirect_uri: redirectUri, code_verifier: verifier });
}

/** An access token for OntoForge (`aud` contains ontoforge-api) of a test user. */
export async function userToken(username) {
  return (await userTokens(username)).access_token;
}

/** A test user's ID token (audience: the client, never ontoforge-api). */
export async function idToken(username) {
  return (await userTokens(username)).id_token;
}

/** The service client's access token (client credentials; the audience by default). */
export async function serviceToken() {
  const tokens = await tokenRequest({
    grant_type: 'client_credentials',
    client_id: 'ontoforge-service',
    client_secret: secret('SERVICE_CLIENT_SECRET'),
  });
  return tokens.access_token;
}

/** A token Keycloak signed for another issuer: the Keycloak administrator's, from realm master. */
export async function foreignIssuerToken() {
  const response = await fetch(`${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: secret('KEYCLOAK_ADMIN_USERNAME'),
      password: secret('KEYCLOAK_ADMIN_PASSWORD'),
    }),
  });
  if (!response.ok) throw new Error(`master realm token answered ${response.status}`);
  return (await response.json()).access_token;
}

/** A JWT's claims, unverified (for evidence and self-checks). */
export function claims(jwt) {
  return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
}

/** A well-formed JWT with this issuer's shape, expired an hour ago, signed by nobody. */
export function forgedExpiredToken() {
  const now = Math.floor(Date.now() / 1000);
  const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return [
    part({ alg: 'RS256', typ: 'JWT', kid: 'e2e-forged' }),
    part({ iss: ISSUER, aud: AUDIENCE, sub: 'e2e-forged', typ: 'Bearer', iat: now - 7200, exp: now - 3600 }),
    base64url(randomBytes(256)),
  ].join('.');
}

// --- Keycloak administration (throwaway users) ----------------------------------

async function keycloakAdmin(method, path, body) {
  const token = await foreignIssuerToken();
  const response = await fetch(`${KEYCLOAK_URL}/admin/realms/ontoforge${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`Keycloak admin ${method} ${path} answered ${response.status}`);
  return response;
}

/** A throwaway realm user that has never signed in to OntoForge; returns {id, username, password}. */
export async function createKeycloakUser(username) {
  const password = base64url(randomBytes(18));
  const response = await keycloakAdmin('POST', '/users', {
    username,
    email: `${username}@ontoforge.test`,
    emailVerified: true,
    firstName: 'E2E',
    lastName: username,
    enabled: true,
    credentials: [{ type: 'password', value: password, temporary: false }],
  });
  const id = response.headers.get('location').split('/').pop();
  return { id, username, password };
}

export async function deleteKeycloakUser(id) {
  await keycloakAdmin('DELETE', `/users/${id}`);
}

// --- OntoForge -------------------------------------------------------------------

/**
 * One OntoForge call; never throws for an HTTP status (`status` 0: no answer). `jar` sends the
 * session cookie, `token` a bearer token, `origin` the Origin header (cookie POSTs need
 * WEB_CLIENT_URL's origin). Answers {status, json, text, headers, upstream}.
 */
export async function call(base, method, path, { body, jar, token, origin, headers = {} } = {}) {
  const url = `${base}${path}`;
  try {
    const response = await send(url, {
      method,
      jar,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(origin ? { origin } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    return { status: response.status, json, text, headers: response.headers, upstream: response.headers.get('x-upstream') };
  } catch (error) {
    return { status: 0, json: null, text: String(error?.cause?.code ?? error?.message ?? error), headers: new Headers(), upstream: null };
  }
}

/** A Keycloak callback URL (already signed in), not yet delivered: see `appLogin`. */
export async function startAppLogin(base, username, { jar = new CookieJar(), returnTo = '/', password } = {}) {
  const start = await send(`${base}/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`, { jar });
  await start.arrayBuffer();
  if (start.status !== 302 && start.status !== 303) throw new Error(`GET /api/auth/login answered ${start.status}, expected a redirect`);
  const authorization = new URL(start.headers.get('location'), base).href;
  const callback = await keycloakLogin(authorization, username, password ?? passwordOf(username), jar);
  return { jar, callback };
}

/** Delivers a callback URL's path and query to `base`; answers {status, location}. */
export async function deliverCallback(base, callback, jar) {
  const { pathname, search } = new URL(callback);
  const response = await send(`${base}${pathname}${search}`, { jar });
  await response.arrayBuffer();
  return { status: response.status, location: response.headers.get('location') };
}

/**
 * A browser-style sign-in: GET /api/auth/login on `base`, the Keycloak form, then the callback
 * delivered to `deliverTo` (default `base`). Answers {jar, status, location} — on success a
 * redirect to `returnTo` and the session cookie in the jar.
 */
export async function appLogin(base, username, { deliverTo = base, ...options } = {}) {
  const { jar, callback } = await startAppLogin(base, username, options);
  return { jar, ...(await deliverCallback(deliverTo, callback, jar)) };
}

// --- MCP -------------------------------------------------------------------------

/**
 * Connects a real MCP SDK client to `serverUrl` (an MCP mount under PUBLIC_URL) as `username`:
 * the SDK discovers the protected-resource metadata and Keycloak, registers itself dynamically,
 * and sends the user to the authorization URL; `keycloakLogin` stands in for the browser
 * (consent included), the redirect reaches a loopback listener, and the SDK exchanges the code.
 * Answers {client, registration, close} — `close` also deletes the registered Keycloak client.
 */
export async function connectMcp(serverUrl, username) {
  const { Client } = await import(pathToFileURL(join(SDK, 'client', 'index.js')).href);
  const { StreamableHTTPClientTransport } = await import(pathToFileURL(join(SDK, 'client', 'streamableHttp.js')).href);
  const { UnauthorizedError } = await import(pathToFileURL(join(SDK, 'client', 'auth.js')).href);

  // The loopback listener the authorization server redirects to.
  let receive;
  const received = new Promise((resolve) => { receive = resolve; });
  const listener = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    res.end('Signed in; you can close this window.');
    if (url.pathname === '/callback') receive(url);
  });
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const redirectUrl = `http://127.0.0.1:${listener.address().port}/callback`;

  const store = {};
  let authorizationUrl = null;
  const provider = {
    get redirectUrl() { return redirectUrl; },
    get clientMetadata() {
      return {
        client_name: `ontoforge-e2e-${username}`,
        redirect_uris: [redirectUrl],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      };
    },
    clientInformation: () => store.client,
    saveClientInformation: (info) => { store.client = info; },
    tokens: () => store.tokens,
    saveTokens: (tokens) => { store.tokens = tokens; },
    redirectToAuthorization: (url) => { authorizationUrl = url; },
    saveCodeVerifier: (verifier) => { store.verifier = verifier; },
    codeVerifier: () => store.verifier,
  };
  // The SDK keeps only RFC 7591's fields; the registration's management token is read here.
  const registration = {};
  const fetchFn = async (url, init) => {
    const response = await fetch(url, init);
    if (init?.method === 'POST' && response.status === 201) {
      const json = await response.clone().json().catch(() => null);
      if (json?.registration_access_token) {
        Object.assign(registration, { clientId: json.client_id, uri: json.registration_client_uri, token: json.registration_access_token });
      }
    }
    return response;
  };
  const transportOptions = { authProvider: provider, fetch: fetchFn };
  const client = new Client({ name: 'ontoforge-e2e', version: '1.0.0' });

  const close = async () => {
    await client.close().catch(() => {});
    listener.close();
    if (registration.uri) {
      await fetch(registration.uri, { method: 'DELETE', headers: { authorization: `Bearer ${registration.token}` } }).catch(() => {});
    }
  };
  try {
    const first = new StreamableHTTPClientTransport(new URL(serverUrl), transportOptions);
    try {
      await client.connect(first);
      return { client, registration, close }; // tokens already held: nothing to authorize
    } catch (error) {
      if (!(error instanceof UnauthorizedError) || !authorizationUrl) throw error;
    }
    const delivered = await keycloakLogin(authorizationUrl.href, username, passwordOf(username), new CookieJar());
    await fetch(delivered); // the browser following the redirect to the loopback listener
    const callback = await received;
    const code = callback.searchParams.get('code');
    if (!code) throw new Error(`authorization returned no code (${callback.searchParams.get('error') ?? 'no error'})`);
    await first.finishAuth(code);
    await client.connect(new StreamableHTTPClientTransport(new URL(serverUrl), transportOptions));
    return { client, registration, close };
  } catch (error) {
    await close();
    throw error;
  }
}

// --- Self-check ------------------------------------------------------------------

/** Tokens from the running Keycloak, checked by their claims; prints no token and no secret. */
async function selfCheck() {
  let failed = false;
  const check = (label, ok, evidence) => {
    console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label} — ${evidence}`);
    if (!ok) failed = true;
  };
  const aud = (c) => [c.aud].flat().filter(Boolean);
  const show = (c) => `iss ${c.iss}, aud ${JSON.stringify(c.aud ?? null)}, typ ${c.typ}, azp ${c.azp}, sub ${c.sub ? 'present' : 'absent'}, scope "${c.scope ?? ''}"`;

  console.log(`Keycloak ${ISSUER}`);
  const config = await oidcConfiguration();
  check('discovery', config.issuer === ISSUER && !!config.registration_endpoint, `issuer ${config.issuer}, registration endpoint ${config.registration_endpoint ? 'present' : 'absent'}`);

  const reader = await userTokens('reader');
  const access = claims(reader.access_token);
  check('reader access token (ontoforge-mcp, code + PKCE, form driven)',
    aud(access).includes(AUDIENCE) && access.iss === ISSUER && access.typ === 'Bearer' && access.sub === subject('reader'),
    `${show(access)}, sub = SUBJECT_READER ${access.sub === subject('reader')}`);
  const id = claims(reader.id_token);
  check('reader ID token', id.typ === 'ID' && !aud(id).includes(AUDIENCE) && id.iss === ISSUER, show(id));

  const plain = claims((await userTokens('reader', { scope: 'openid' })).access_token);
  check('access token without the ontoforge-api scope lacks the audience', !aud(plain).includes(AUDIENCE), show(plain));

  const service = claims(await serviceToken());
  check('service token (client credentials)', aud(service).includes(AUDIENCE) && service.iss === ISSUER && service.sub === subject('service'),
    `${show(service)}, sub = SUBJECT_SERVICE ${service.sub === subject('service')}`);

  const foreign = claims(await foreignIssuerToken());
  check('foreign-issuer token (realm master)', foreign.iss !== ISSUER, show(foreign));

  const forged = claims(forgedExpiredToken());
  check('forged expired token', forged.exp < Date.now() / 1000, `exp ${new Date(forged.exp * 1000).toISOString()}`);

  // Dynamic registration and consent as an MCP client meets them, without an MCP server.
  const port = await freePort();
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const registered = await fetch(config.registration_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'ontoforge-selfcheck', redirect_uris: [redirectUri], grant_types: ['authorization_code'],
      response_types: ['code'], token_endpoint_auth_method: 'none', scope: AUDIENCE,
    }),
  });
  const client = await registered.json();
  check('dynamic client registration', registered.status === 201 && !!client.client_id, `HTTP ${registered.status}`);
  if (registered.status === 201) {
    try {
      const verifier = base64url(randomBytes(32));
      const url = new URL(config.authorization_endpoint);
      url.search = new URLSearchParams({
        client_id: client.client_id, response_type: 'code', redirect_uri: redirectUri, scope: AUDIENCE, state: 's',
        code_challenge: base64url(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
      }).toString();
      const callback = new URL(await keycloakLogin(url.href, 'reader', passwordOf('reader'), new CookieJar()));
      const tokens = await tokenRequest({
        grant_type: 'authorization_code', client_id: client.client_id, code: callback.searchParams.get('code'),
        redirect_uri: redirectUri, code_verifier: verifier,
      });
      const dcr = claims(tokens.access_token);
      check('registered client: consent accepted, token for OntoForge', aud(dcr).includes(AUDIENCE) && dcr.iss === ISSUER, show(dcr));
    } finally {
      const removed = await fetch(client.registration_client_uri, { method: 'DELETE', headers: { authorization: `Bearer ${client.registration_access_token}` } });
      check('registered client removed', removed.status === 204, `HTTP ${removed.status}`);
    }
  }

  const fresh = await createKeycloakUser(`e2e-selfcheck-${base64url(randomBytes(4)).toLowerCase()}`);
  await deleteKeycloakUser(fresh.id);
  check('throwaway Keycloak user created and deleted', !!fresh.id, 'admin API');

  console.log(failed ? 'Self-check failed.' : 'Self-check passed.');
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === '--self-check') {
  await selfCheck();
}
