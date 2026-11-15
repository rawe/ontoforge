// Shared helpers for the authentication checks (e2e.mjs, scripts/scale/scenarios.mjs): a
// cookie jar, the Keycloak sign-in form driven without a browser, a browser going through
// OntoForge's authorization server (sign-in and consent), OntoForge tokens of the development
// realm's test users through the command-line client (cli.mjs), provider tokens for checks
// that refuse them, a browser-style sign-in to OntoForge, an HTTP call with a cookie or a
// token, and an MCP SDK client that authorizes itself at OntoForge. Node 22; the MCP client
// comes from the server's installed SDK. Secrets come from env/keycloak.local.env
// (./dev.sh keycloak) and are never printed.
//
//   node scripts/auth/lib.mjs --self-check     tokens from the running Keycloak, claims only

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { signIn } from './cli.mjs';

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
 * A test user's tokens straight from Keycloak — an ID token and an access token without
 * OntoForge's audience — for checks that the server refuses them. The web client's code flow
 * with the form driven by `keycloakLogin`; the code is taken from the redirect before it
 * reaches OntoForge and redeemed with that client's secret.
 */
export async function providerTokens(username) {
  const { authorization_endpoint: endpoint } = await oidcConfiguration();
  const redirectUri = 'http://localhost:5173/api/auth/callback';
  const verifier = base64url(randomBytes(32));
  const state = base64url(randomBytes(16));
  const url = new URL(endpoint);
  url.search = new URLSearchParams({
    client_id: 'ontoforge-web',
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'openid',
    state,
    code_challenge: base64url(createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256',
  }).toString();
  const callback = new URL(await keycloakLogin(url.href, username, passwordOf(username), new CookieJar()));
  if (callback.searchParams.get('state') !== state) throw new Error(`sign-in of ${username} returned another state`);
  const code = callback.searchParams.get('code');
  if (!code) throw new Error(`sign-in of ${username} returned no code (${callback.searchParams.get('error') ?? 'no error'})`);
  return tokenRequest({
    grant_type: 'authorization_code', client_id: 'ontoforge-web', client_secret: secret('OIDC_CLIENT_SECRET'),
    code, redirect_uri: redirectUri, code_verifier: verifier,
  });
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

/** A JWT's claims, unverified (for evidence and self-checks); null for an opaque token. */
export function claims(jwt) {
  if (jwt.split('.').length !== 3) return null;
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

// --- OntoForge's authorization server ---------------------------------------------

/**
 * A browser through OntoForge's authorization server, from an authorization URL (at
 * PUBLIC_URL) on: OntoForge sends it to Keycloak, `keycloakLogin` signs `username` in (or the
 * Keycloak session in `jar` does), OntoForge shows its consent page, and the answer
 * `decision` ('allow' or 'deny') is submitted as a browser submits the form — `Origin` and
 * `Referer` of the consent page. `decision: null` stops at the consent page (see
 * `submitConsent`). `via(url)` names where a request to PUBLIC_URL really goes, such as one
 * backend behind the load balancer; the browser still believes it talks to PUBLIC_URL.
 *
 * Answers {redirect, consent, page, at}: `redirect` is the client's redirect URI with the
 * answer (code or error), not followed; `consent` the consent page's HTML when one was shown;
 * `page` {status, message} when it stopped at another page (an error, a refusal); `at` the
 * consent form's context for `submitConsent`.
 */
export async function authorizeInBrowser(authorizationUrl, username, { password, decision = 'allow', jar = new CookieJar(), via = (url) => url } = {}) {
  const context = { publicOrigin: new URL(authorizationUrl).origin, username, password: password ?? passwordOf(username), jar, via };
  const reached = await browse(context, authorizationUrl, { method: 'GET' });
  if (reached.at === null || decision === null) return reached;
  return { ...(await submitConsent(reached.at, decision)), consent: reached.consent };
}

/**
 * Answers a consent page `at` (from `authorizeInBrowser` with `decision: null`) and follows
 * on. `origin` is the Origin header sent: the consent page's own by default, as a browser
 * sends it; null sends none.
 */
export async function submitConsent(at, decision, { origin = at.context.publicOrigin } = {}) {
  const headers = {
    'content-type': 'application/x-www-form-urlencoded',
    referer: at.pageUrl,
    ...(origin ? { origin } : {}),
  };
  return browse(at.context, at.action, { method: 'POST', headers, body: new URLSearchParams({ decision }).toString() });
}

/** Follows the browser until the consent page, a redirect leaving PUBLIC_URL and Keycloak, or another page. */
async function browse(context, url, request) {
  const keycloak = new URL(ISSUER).origin;
  const result = (fields) => ({ redirect: null, consent: null, page: null, at: null, ...fields });
  for (let hop = 0; hop < 20; hop++) {
    const { origin } = new URL(url);
    if (origin === keycloak) {
      url = await keycloakLogin(url, context.username, context.password, context.jar);
      request = { method: 'GET' };
      continue;
    }
    if (origin !== context.publicOrigin) return result({ redirect: url });
    const response = await send(context.via(url), { ...request, jar: context.jar });
    if (response.status >= 300 && response.status < 400) {
      await response.arrayBuffer();
      url = new URL(response.headers.get('location'), url).href;
      request = { method: 'GET' };
      continue;
    }
    const html = await response.text();
    const action = /<form\b[^>]*\baction="([^"]*)"/i.exec(html)?.[1];
    if (response.status === 200 && action && html.includes('name="decision"')) {
      return result({ consent: html, at: { context, action: new URL(decodeHtml(action), url).href, pageUrl: url } });
    }
    return result({ page: { status: response.status, message: pageMessage(html) } });
  }
  throw new Error(`authorization of ${context.username}: more than 20 redirects`);
}

/** The text of a page without its markup (for checks on the consent page's content). */
export const pageText = (html) => decodeHtml(html.replace(/<head>[\s\S]*<\/head>/i, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/**
 * OntoForge tokens of a test user for `resource` (`PUBLIC_URL/api` or an MCP mount's URL),
 * through the command-line client (cli.mjs) with `authorizeInBrowser` as its browser.
 * Answers the token response plus `consent` (the consent page's HTML); throws when the
 * authorization ends on a page or with an error (Deny).
 */
export async function ontoforgeTokens(username, resource, { clientId, ...browser } = {}) {
  let consent = null;
  const tokens = await signIn({
    resource,
    clientId,
    openUrl: async (url) => {
      const outcome = await authorizeInBrowser(url, username, browser);
      consent = outcome.consent;
      if (outcome.redirect === null) throw new Error(`authorization of ${username} stopped at a page: HTTP ${outcome.page?.status} ${outcome.page?.message}`);
      await fetch(outcome.redirect); // the browser following the redirect to the loopback listener
    },
  });
  return { ...tokens, consent };
}

/** One token request at `base`/oauth/token; never throws for an HTTP status. Answers {status, json}. */
export async function oauthToken(base, fields) {
  const response = await fetch(`${base}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

/** An authorization request's URL and what redeeming its code needs: PKCE, state, a loopback redirect. */
export async function authorizationRequest(publicUrl, { clientId = 'ontoforge-cli', resource }) {
  const verifier = base64url(randomBytes(32));
  const state = base64url(randomBytes(16));
  const redirectUri = `http://127.0.0.1:${await freePort()}/callback`;
  const url = new URL(`${publicUrl}/oauth/authorize`);
  url.search = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state, resource,
    code_challenge: base64url(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
  }).toString();
  return { url: url.href, clientId, redirectUri, state, verifier, resource };
}

// --- MCP -------------------------------------------------------------------------

/**
 * Connects a real MCP SDK client to `serverUrl` (an MCP mount under PUBLIC_URL) as `username`
 * with the client ID `clientId` (an OAUTH_CLIENTS entry with a loopback redirect): the SDK
 * discovers the protected-resource metadata and OntoForge's authorization server, and sends
 * the person to the authorization URL; `authorizeInBrowser` stands in for the browser (Keycloak
 * sign-in, consent), the redirect reaches a loopback listener, and the SDK exchanges the code.
 * Answers {client, authorizationUrl, consent, tokens(), close}.
 */
export async function connectMcp(serverUrl, username, { clientId = 'ontoforge-cli' } = {}) {
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
      return { client_name: 'OntoForge e2e', redirect_uris: [redirectUrl], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' };
    },
    // Known to the server by configuration: nothing to register.
    clientInformation: () => ({ client_id: clientId }),
    tokens: () => store.tokens,
    saveTokens: (tokens) => { store.tokens = tokens; },
    redirectToAuthorization: (url) => { authorizationUrl = url; },
    saveCodeVerifier: (verifier) => { store.verifier = verifier; },
    codeVerifier: () => store.verifier,
  };
  const transportOptions = { authProvider: provider };
  const client = new Client({ name: 'ontoforge-e2e', version: '1.0.0' });
  const close = async () => {
    await client.close().catch(() => {});
    listener.close();
  };
  try {
    const first = new StreamableHTTPClientTransport(new URL(serverUrl), transportOptions);
    try {
      await client.connect(first);
      throw new Error('the mount answered without authorization');
    } catch (error) {
      if (!(error instanceof UnauthorizedError) || !authorizationUrl) throw error;
    }
    const outcome = await authorizeInBrowser(authorizationUrl.href, username);
    if (outcome.redirect === null) throw new Error(`authorization stopped at a page: HTTP ${outcome.page?.status} ${outcome.page?.message}`);
    await fetch(outcome.redirect); // the browser following the redirect to the loopback listener
    const callback = await received;
    const code = callback.searchParams.get('code');
    if (!code) throw new Error(`authorization returned no code (${callback.searchParams.get('error') ?? 'no error'})`);
    await first.finishAuth(code);
    await client.connect(new StreamableHTTPClientTransport(new URL(serverUrl), transportOptions));
    return { client, authorizationUrl, consent: outcome.consent, tokens: () => store.tokens, close };
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
  check('discovery', config.issuer === ISSUER, `issuer ${config.issuer}`);

  const reader = await providerTokens('reader');
  const access = claims(reader.access_token);
  check('reader access token (ontoforge-web, code + PKCE, form driven) lacks the audience',
    !aud(access).includes(AUDIENCE) && access.iss === ISSUER && access.sub === subject('reader'),
    `${show(access)}, sub = SUBJECT_READER ${access.sub === subject('reader')}`);
  const id = claims(reader.id_token);
  check('reader ID token', id.typ === 'ID' && !aud(id).includes(AUDIENCE) && id.iss === ISSUER, show(id));

  const service = claims(await serviceToken());
  check('service token (client credentials) carries the audience', aud(service).includes(AUDIENCE) && service.iss === ISSUER && service.sub === subject('service'),
    `${show(service)}, sub = SUBJECT_SERVICE ${service.sub === subject('service')}`);

  const foreign = claims(await foreignIssuerToken());
  check('foreign-issuer token (realm master)', foreign.iss !== ISSUER, show(foreign));

  const forged = claims(forgedExpiredToken());
  check('forged expired token', forged.exp < Date.now() / 1000, `exp ${new Date(forged.exp * 1000).toISOString()}`);

  const fresh = await createKeycloakUser(`e2e-selfcheck-${base64url(randomBytes(4)).toLowerCase()}`);
  await deleteKeycloakUser(fresh.id);
  check('throwaway Keycloak user created and deleted', !!fresh.id, 'admin API');

  console.log(failed ? 'Self-check failed.' : 'Self-check passed.');
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === '--self-check') {
  await selfCheck();
}
