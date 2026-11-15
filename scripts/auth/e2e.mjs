#!/usr/bin/env node
// End-to-end check of authentication against a running server with AUTH_ENABLED=true and the
// development Keycloak: browser sign-in, sessions, CSRF, OntoForge's authorization server
// (the command-line client cli.mjs, consent, refresh rotation, resources) and a real MCP SDK
// client on it, provider tokens of machines, roles, revocation, disabling and user
// management. See USAGE.md.
//
//   node scripts/auth/e2e.mjs [--base http://localhost:5173] [--public-url http://localhost:8000]
//                             [--idle-seconds N] [--no-fresh-user]
//
// Prints PASS, FAIL or SKIP per check with its evidence (statuses, ids — never a token or a
// password); exit 1 when a check failed, 2 when the server cannot be checked at all. It
// creates the ontology e2e_auth_<random> and deletes it at the end.

import { randomBytes } from 'node:crypto';
import { listTools, refresh } from './cli.mjs';
import {
  AUDIENCE, CookieJar, ISSUER, appLogin, authorizationRequest, authorizeInBrowser, call, claims, connectMcp, createKeycloakUser, deleteKeycloakUser,
  deliverCallback, forgedExpiredToken, foreignIssuerToken, oauthToken, ontoforgeTokens, pageText, providerTokens,
  serviceToken, startAppLogin, subject, submitConsent,
} from './lib.mjs';

const option = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
};
// The web client's address (WEB_CLIENT_URL): browser sign-in, cookies and REST go here.
const BASE = option('--base', 'http://localhost:5173').replace(/\/$/, '');
const ORIGIN = new URL(BASE).origin;
// The server's address (PUBLIC_URL): the authorization server's issuer; tokens name resources below it.
const PUBLIC = option('--public-url', 'http://localhost:8000').replace(/\/$/, '');
const API = `${PUBLIC}/api`;
// A real client metadata document (CIMD), fetched by the server when online.
const CLAUDE_CODE = 'https://claude.ai/oauth/claude-code-client-metadata';
const IDLE = option('--idle-seconds', null);
const FRESH_USER = !process.argv.includes('--no-fresh-user');
const FOREIGN = 'http://evil.example';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Reporting ---------------------------------------------------------------------

const totals = { PASS: 0, FAIL: 0, SKIP: 0 };
class Skip extends Error {}

function report(result, label, evidence) {
  totals[result]++;
  console.log(`  ${result} ${label}${evidence ? ` — ${evidence}` : ''}`);
}
const check = (label, ok, evidence) => { report(ok ? 'PASS' : 'FAIL', label, evidence); return ok; };
const skip = (label, reason) => report('SKIP', label, reason);
/** Stops a step whose prerequisite is missing; its remaining checks count as one SKIP. */
const need = (value, reason) => { if (!value) throw new Skip(reason); return value; };

/** Status and error code of an answer, for evidence. */
const said = (r) => `HTTP ${r.status}${r.json?.error?.code ? ` ${r.json.error.code}` : ''}`;
const isOneOf = (r, ...statuses) => statuses.includes(r.status);
/** A redirect's target as path + query (servers may answer absolute or relative). */
const target = (location) => {
  if (!location) return null;
  const url = new URL(location, BASE);
  return `${url.pathname}${url.search}`;
};

// --- Shared state of the run ------------------------------------------------------------

const stamp = randomBytes(4).toString('hex');
const ctx = {
  ontology: `e2e_auth_${stamp}`,
  lensA: 'lens_a',
  lensB: 'lens_b',
  type: 'item',
  admin: null, // { jar, id }
  users: {}, // username → OntoForge user id
  grants: {}, // name → { userId, assignmentId }
  tokens: {},
  ontologyCreated: false,
  creatorGranted: null, // assignment id the run granted the administrator
};

const asAdmin = (method, path, body) => call(BASE, method, path, { jar: ctx.admin.jar, origin: ORIGIN, body });
const runtime = (lens) => `/api/ontologies/${ctx.ontology}/runtime/lenses/${lens}`;
const mountUrl = (lens) => `${PUBLIC}/mcp/ontologies/${ctx.ontology}/runtime/lenses/${lens}`;
const isOpaque = (token) => typeof token === 'string' && token.length > 0 && claims(token) === null;
const me = (auth) => call(BASE, 'GET', '/api/auth/me', auth);
const roles = (meAnswer) => (meAnswer.json?.assignments ?? []).map((a) => a.role);

/** A browser sign-in and its /api/auth/me; answers {jar, status, location, me}. */
async function browserLogin(username, options) {
  const login = await appLogin(BASE, username, options);
  return { ...login, me: await me({ jar: login.jar }) };
}

/** Grants a role through the administrator's session; answers the call. */
async function grant(name, userId, body) {
  const r = await asAdmin('POST', `/api/users/${userId}/assignments`, body);
  if (r.status === 201) ctx.grants[name] = { userId, assignmentId: r.json?.id };
  return r;
}

/** Users matching a search, through the administrator. */
async function findUsers(search) {
  const r = await asAdmin('GET', `/api/users?search=${encodeURIComponent(search)}&limit=50`);
  return { status: r.status, items: r.json?.items ?? [] };
}

// --- Steps ------------------------------------------------------------------------------

async function serverStep() {
  const info = await call(BASE, 'GET', '/api/server/info');
  check('server info names authentication', info.status === 200 && info.json?.authentication === true,
    `${said(info)}, authentication ${info.json?.authentication}`);
  check('server info reports PUBLIC_URL as its address', info.json?.baseUrl === PUBLIC, `baseUrl ${info.json?.baseUrl}`);
  const anonymous = await me({});
  check('/api/auth/me without credentials', anonymous.status === 200 && anonymous.json?.authentication === true && anonymous.json?.user === null,
    `${said(anonymous)}, user ${JSON.stringify(anonymous.json?.user)}`);
}

async function adminStep() {
  const login = await browserLogin('admin');
  check('admin browser sign-in: callback redirects back', isOneOf(login, 302, 303) && target(login.location) === '/',
    `HTTP ${login.status} → ${login.location}, cookies ${login.jar.names(BASE).join(', ')}`);
  const user = login.me.json?.user;
  check('admin session: /api/auth/me names the user', login.me.status === 200 && !!user?.id && user.username === 'admin',
    `${said(login.me)}, user ${user?.id} (${user?.username}), status ${user?.status}`);
  check('admin is platform administrator', roles(login.me).includes('platform_admin'), `roles ${JSON.stringify(roles(login.me))}`);
  if (user?.id) ctx.admin = { jar: login.jar, id: user.id };
}

async function newcomerStep() {
  need(ctx.admin, 'needs the administrator session');
  const before = await findUsers('newcomer');
  const existed = before.items.some((u) => u.username === 'newcomer');
  const first = await browserLogin('newcomer');
  const user = first.me.json?.user;
  check('newcomer signs in', first.me.status === 200 && !!user?.id, `HTTP ${first.status} → ${first.location}, user ${user?.id}`);
  check('newcomer has no access assigned', Array.isArray(first.me.json?.assignments) && first.me.json.assignments.length === 0,
    `assignments ${JSON.stringify(first.me.json?.assignments)}`);
  const listed = await call(BASE, 'GET', '/api/ontologies', { jar: first.jar });
  check('newcomer sees no ontology', listed.status === 200 && Array.isArray(listed.json) && listed.json.length === 0,
    `${said(listed)}, ${Array.isArray(listed.json) ? listed.json.length : '-'} ontologies`);
  const after = await findUsers('newcomer');
  const matches = after.items.filter((u) => u.username === 'newcomer');
  if (existed) {
    skip('first sign-in creates the user', 'newcomer already existed in the access database (a rerun); a fresh access database proves creation');
  } else {
    check('first sign-in creates exactly one user', matches.length === 1 && matches[0].id === user?.id,
      `before: none; after: ${matches.length} (${matches.map((u) => u.id).join(', ')})`);
  }
  const again = await browserLogin('newcomer');
  const count = (await findUsers('newcomer')).items.filter((u) => u.username === 'newcomer').length;
  check('repeat sign-in reuses the user', again.me.json?.user?.id === user?.id && count === matches.length,
    `first ${user?.id}, repeat ${again.me.json?.user?.id}, users named newcomer: ${matches.length} before the repeat, ${count} after`);
}

async function concurrentStep() {
  need(ctx.admin, 'needs the administrator session');
  need(FRESH_USER, '--no-fresh-user: no identity that never signed in');
  const fresh = await createKeycloakUser(`e2e-${stamp}`);
  try {
    const n = 5;
    // Each through Keycloak on its own; then the callbacks land together.
    const pending = await Promise.all(Array.from({ length: n }, () =>
      startAppLogin(BASE, fresh.username, { password: fresh.password })));
    const delivered = await Promise.all(pending.map(({ jar, callback }) => deliverCallback(BASE, callback, jar)));
    const ids = await Promise.all(pending.map(async ({ jar }) => (await me({ jar })).json?.user?.id ?? null));
    const distinct = [...new Set(ids)];
    check(`${n} concurrent first sign-ins of one identity`, delivered.every((d) => isOneOf(d, 302, 303) && target(d.location) === '/') && distinct.length === 1 && distinct[0] !== null,
      `callbacks ${delivered.map((d) => d.status).join('/')}, user ids ${distinct.join(', ')}`);
    const stored = (await findUsers(fresh.username)).items.filter((u) => u.username === fresh.username);
    check('exactly one local user for it', stored.length === 1, `${stored.length} user(s) named ${fresh.username}`);
    if (distinct[0]) {
      const off = await asAdmin('PATCH', `/api/users/${distinct[0]}`, { status: 'disabled' });
      console.log(`    · cleanup: ${fresh.username} disabled in OntoForge (${said(off)})`);
    }
  } finally {
    await deleteKeycloakUser(fresh.id);
    console.log(`    · cleanup: Keycloak user ${fresh.username} deleted`);
  }
}

async function logoutStep() {
  const { jar, me: before } = await browserLogin('newcomer');
  need(before.json?.user, 'newcomer could not sign in');
  const noOrigin = await call(BASE, 'POST', '/api/auth/logout', { jar });
  check('logout without Origin (cookie session) is refused', noOrigin.status === 403, said(noOrigin));
  const foreign = await call(BASE, 'POST', '/api/auth/logout', { jar, origin: FOREIGN });
  check('logout with a foreign Origin is refused', foreign.status === 403, said(foreign));
  const still = await me({ jar });
  check('session survives the refused logouts', still.json?.user?.id === before.json.user.id, `user ${still.json?.user?.id}`);
  const out = await call(BASE, 'POST', '/api/auth/logout', { jar, origin: ORIGIN });
  const logoutUrl = out.json?.logoutUrl;
  check('logout with Origin = WEB_CLIENT_URL', out.status === 200 && typeof logoutUrl === 'string' && logoutUrl.startsWith(ISSUER),
    `${said(out)}, logoutUrl ${logoutUrl ? new URL(logoutUrl).pathname : '-'}`);
  const after = await me({ jar });
  check('session ended: /api/auth/me', after.status === 200 && after.json?.user === null, `${said(after)}, user ${JSON.stringify(after.json?.user)}`);
  const protectedCall = await call(BASE, 'GET', '/api/ontologies', { jar });
  check('session ended: protected route', protectedCall.status === 401, said(protectedCall));
}

async function csrfStep() {
  need(ctx.admin, 'needs the administrator session');
  const key = `e2e_auth_csrf_${stamp}`;
  const r = await call(BASE, 'POST', '/api/ontologies', { jar: ctx.admin.jar, origin: FOREIGN, body: { key } });
  check('cookie POST with a foreign Origin is refused', r.status === 403, said(r));
  if (r.status === 201) await asAdmin('DELETE', `/api/ontologies/${key}`);
}

async function setupStep() {
  need(ctx.admin, 'needs the administrator session');
  const own = (await me({ jar: ctx.admin.jar })).json?.assignments ?? [];
  if (!own.some((a) => a.role === 'ontology_creator')) {
    const r = await grant('creator', ctx.admin.id, { role: 'ontology_creator' });
    check('administrator grants itself ontology_creator', r.status === 201, `${said(r)}, assignment ${r.json?.id}`);
    if (r.status === 201) ctx.creatorGranted = r.json?.id;
  } else {
    console.log('    · administrator already holds ontology_creator');
  }
  const created = await asAdmin('POST', '/api/ontologies', { key: ctx.ontology, displayName: 'E2E authentication' });
  ctx.ontologyCreated = created.status === 201;
  need(check('administrator creates the ontology', ctx.ontologyCreated, `${said(created)} ${ctx.ontology}`), 'no ontology');
  const model = `/api/ontologies/${ctx.ontology}/model`;
  for (const key of [ctx.lensA, ctx.lensB]) {
    const lens = await asAdmin('POST', `${model}/lenses`, { key, name: key });
    check(`lens ${key}`, lens.status === 201, `${said(lens)} ${lens.json?.lensId ?? ''}`);
  }
  const type = await asAdmin('POST', `${model}/entity-types`, { key: ctx.type, displayName: 'Item' });
  check(`entity type ${ctx.type}`, type.status === 201, `${said(type)} ${type.json?.entityTypeId ?? ''}`);

  for (const [username, role] of [['reader', 'reader'], ['writer', 'writer']]) {
    const login = await browserLogin(username);
    const id = login.me.json?.user?.id;
    check(`${username} signs in`, !!id, `HTTP ${login.status} → ${login.location}, user ${id}`);
    if (!id) continue;
    ctx.users[username] = id;
    const r = await grant(username, id, { role, ontologyKey: ctx.ontology, lensKey: ctx.lensA });
    check(`${username} gets ${role} on ${ctx.lensA}`, r.status === 201, `${said(r)}, assignment ${r.json?.id}`);
  }
}

async function authorizationServerStep() {
  const r = await call(PUBLIC, 'GET', '/.well-known/oauth-authorization-server');
  const m = r.json ?? {};
  check('authorization server metadata at PUBLIC_URL', r.status === 200 && m.issuer === PUBLIC
    && m.authorization_endpoint === `${PUBLIC}/oauth/authorize` && m.token_endpoint === `${PUBLIC}/oauth/token`,
    `${said(r)}, issuer ${m.issuer}, authorize ${m.authorization_endpoint}, token ${m.token_endpoint}`);
  check('PKCE S256, public clients, client documents', (m.code_challenge_methods_supported ?? []).includes('S256')
    && JSON.stringify(m.token_endpoint_auth_methods_supported) === '["none"]' && m.client_id_metadata_document_supported === true
    && !m.registration_endpoint,
    `PKCE ${JSON.stringify(m.code_challenge_methods_supported)}, auth ${JSON.stringify(m.token_endpoint_auth_methods_supported)}, CIMD ${m.client_id_metadata_document_supported}, registration ${m.registration_endpoint ?? 'none'}`);
  const api = await call(BASE, 'GET', '/api/ontologies');
  const header = api.headers.get('www-authenticate') ?? '';
  const metadataUrl = /resource_metadata="([^"]+)"/.exec(header)?.[1];
  check('REST without a token → 401 pointing to its resource metadata', api.status === 401 && metadataUrl === `${PUBLIC}/.well-known/oauth-protected-resource/api`,
    `${said(api)}, WWW-Authenticate ${header || 'absent'}`);
  const doc = await call(PUBLIC, 'GET', '/.well-known/oauth-protected-resource/api');
  check('the REST API names PUBLIC_URL/api and this authorization server', doc.status === 200 && doc.json?.resource === API
    && JSON.stringify(doc.json?.authorization_servers) === JSON.stringify([PUBLIC]),
    `${said(doc)}, resource ${doc.json?.resource}, authorization_servers ${JSON.stringify(doc.json?.authorization_servers)}`);
}

async function cliStep() {
  need(ctx.ontologyCreated, 'needs the e2e ontology');
  need(ctx.grants.reader && ctx.grants.writer, 'needs the reader and writer grants');
  for (const username of ['reader', 'writer']) {
    const tokens = await ontoforgeTokens(username, API);
    ctx.tokens[username] = tokens.access_token;
    ctx.tokens[`${username}Refresh`] = tokens.refresh_token;
    const shown = pageText(tokens.consent ?? '');
    const answer = await me({ token: tokens.access_token });
    check(`command-line client signs ${username} in for the REST API`,
      isOpaque(tokens.access_token) && isOpaque(tokens.refresh_token) && answer.json?.user?.username === username,
      `opaque access + refresh token, expires_in ${tokens.expires_in}, /api/auth/me ${said(answer)} user ${answer.json?.user?.username}`);
    if (username === 'reader') {
      check('the consent page names the client, the person, the redirect and the REST API',
        shown.includes('OntoForge CLI wants to act as you') && shown.includes('ontoforge-cli') && shown.includes('http://127.0.0.1:')
          && shown.includes('reader@ontoforge.test') && shown.includes('the REST API'),
        shown.slice(0, 220));
    }
  }
}

async function restStep() {
  need(ctx.tokens.reader && ctx.tokens.writer, 'needs the reader and writer tokens');
  const reader = { token: ctx.tokens.reader };
  const writer = { token: ctx.tokens.writer };
  const list = (lens, auth) => call(BASE, 'GET', `${runtime(lens)}/entities/${ctx.type}?limit=5`, auth);
  const create = (lens, auth, label) => call(BASE, 'POST', `${runtime(lens)}/entities/${ctx.type}`, { ...auth, body: { name: `${label} ${stamp}` } });

  let r = await list(ctx.lensA, reader);
  check('reader reads lens A (bearer)', r.status === 200, `${said(r)}, total ${r.json?.total}`);
  r = await create(ctx.lensA, reader, 'by reader');
  check('reader writes lens A → 403', r.status === 403, said(r));
  r = await list(ctx.lensB, reader);
  check('reader on lens B → 404', r.status === 404, said(r));
  r = await create(ctx.lensA, writer, 'by writer');
  check('writer writes lens A → 201', r.status === 201, `${said(r)} ${r.json?._id ?? ''}`);
  r = await list(ctx.lensB, writer);
  check('writer on lens B → 404', r.status === 404, said(r));

  const ontologies = await call(BASE, 'GET', '/api/ontologies', reader);
  const keys = (ontologies.json ?? []).map?.((o) => o.key) ?? [];
  check('reader lists only ontologies it holds a role in', ontologies.status === 200 && keys.includes(ctx.ontology),
    `${said(ontologies)}, ${keys.length} ontologies, e2e ontology ${keys.includes(ctx.ontology) ? 'listed' : 'missing'}`);
  const lenses = await call(BASE, 'GET', `/api/ontologies/${ctx.ontology}/model/lenses`, reader);
  const lensKeys = (lenses.json ?? []).map?.((l) => l.key) ?? [];
  check('reader lists only lens A', lenses.status === 200 && lensKeys.join() === ctx.lensA, `${said(lenses)}, lenses ${JSON.stringify(lensKeys)}`);

  const challenged = async (label, token) => {
    const answer = await list(ctx.lensA, token === undefined ? {} : { token });
    const header = answer.headers.get('www-authenticate') ?? '';
    check(label, answer.status === 401 && /^Bearer\b/i.test(header), `${said(answer)}, WWW-Authenticate ${header || 'absent'}`);
  };
  await challenged('no token → 401 with a challenge', undefined);
  const provider = await providerTokens('reader');
  await challenged(`provider token of a person without audience ${AUDIENCE} (aud ${JSON.stringify(claims(provider.access_token).aud)}) → 401`, provider.access_token);
  await challenged('garbage token → 401', 'not-a-token');
  await challenged('forged expired token → 401', forgedExpiredToken());
  await challenged('ID token as bearer → 401', provider.id_token);
  const foreign = await foreignIssuerToken();
  await challenged(`token of another issuer (${claims(foreign).iss}) → 401`, foreign);
  const service = await serviceToken();
  await challenged('service token with a broken signature → 401', service.slice(0, -4) + (service.endsWith('AAAA') ? 'BBBB' : 'AAAA'));
  const changed = ctx.tokens.reader.slice(0, -1) + (ctx.tokens.reader.endsWith('A') ? 'B' : 'A');
  await challenged('OntoForge token with one character changed → 401', changed);
}

async function rotationStep() {
  need(ctx.grants.reader, 'needs the reader grant');
  // A sign-in of its own: reusing a refresh token revokes its whole authorization.
  const first = await ontoforgeTokens('reader', API);
  const second = await refresh({ resource: API, refreshToken: first.refresh_token });
  check('refresh: a new access and refresh token', isOpaque(second.access_token) && second.access_token !== first.access_token
    && isOpaque(second.refresh_token) && second.refresh_token !== first.refresh_token,
    `new access token ${second.access_token !== first.access_token}, new refresh token ${second.refresh_token !== first.refresh_token}`);
  const fresh = await me({ token: second.access_token });
  check('the refreshed access token works', fresh.json?.user?.username === 'reader', `${said(fresh)}, user ${fresh.json?.user?.username}`);
  const reused = await oauthToken(PUBLIC, { grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: 'ontoforge-cli', resource: API });
  check('the spent refresh token is refused', reused.status === 400 && reused.json?.error === 'invalid_grant',
    `HTTP ${reused.status} ${reused.json?.error} (${reused.json?.error_description})`);
  const revoked = await call(BASE, 'GET', '/api/ontologies', { token: second.access_token });
  const again = await oauthToken(PUBLIC, { grant_type: 'refresh_token', refresh_token: second.refresh_token, client_id: 'ontoforge-cli', resource: API });
  check('its reuse revoked the authorization: newest access and refresh token refused',
    revoked.status === 401 && again.status === 400,
    `/api/ontologies ${said(revoked)}, refresh HTTP ${again.status} ${again.json?.error}`);
}

async function consentStep() {
  need(ctx.grants.reader, 'needs the reader grant');
  const request = await authorizationRequest(PUBLIC, { resource: API });
  const reached = await authorizeInBrowser(request.url, 'reader', { decision: null });
  const at = need(reached.at, `no consent page (${reached.page ? `HTTP ${reached.page.status} ${reached.page.message}` : reached.redirect})`);
  const none = await submitConsent(at, 'allow', { origin: null });
  const foreign = await submitConsent(at, 'allow', { origin: FOREIGN });
  check('the consent answer is refused without Origin or with a foreign one', none.page?.status === 403 && foreign.page?.status === 403,
    `without Origin HTTP ${none.page?.status}, foreign Origin HTTP ${foreign.page?.status}`);
  const deny = await submitConsent(at, 'deny');
  const answer = deny.redirect ? new URL(deny.redirect) : null;
  check("Deny (with the consent page's Origin) → the client gets access_denied, no code",
    answer !== null && `${answer.origin}${answer.pathname}` === request.redirectUri && answer.searchParams.get('error') === 'access_denied'
      && answer.searchParams.get('state') === request.state && !answer.searchParams.has('code'),
    answer ? `redirect ${answer.origin}${answer.pathname}, error ${answer.searchParams.get('error')}, state ${answer.searchParams.get('state') === request.state ? 'kept' : 'differs'}` : `HTTP ${deny.page?.status} ${deny.page?.message}`);
}

async function clientDocumentStep() {
  const doc = await fetch(CLAUDE_CODE, { signal: AbortSignal.timeout(10_000) }).then((r) => (r.ok ? r.json() : null), () => null);
  need(doc?.redirect_uris?.length, `offline: ${CLAUDE_CODE} not reachable from here`);
  const request = new URLSearchParams({
    response_type: 'code', client_id: CLAUDE_CODE, redirect_uri: doc.redirect_uris[0], state: 'cimd', resource: API,
    code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', code_challenge_method: 'S256',
  });
  let path = `/oauth/authorize?${request}`;
  const jar = new CookieJar();
  const hops = [];
  let location = null;
  for (let hop = 0; hop < 5; hop++) {
    const r = await call(PUBLIC, 'GET', path, { jar });
    location = r.headers.get('location');
    hops.push(`${r.status}${location ? ` → ${new URL(location, PUBLIC).origin === PUBLIC ? new URL(location, PUBLIC).pathname : new URL(location, PUBLIC).origin + new URL(location, PUBLIC).pathname}` : ''}`);
    if (!location || new URL(location, PUBLIC).origin !== PUBLIC) break;
    const next = new URL(location, PUBLIC);
    path = next.pathname + next.search;
  }
  const target = location ? new URL(location, PUBLIC) : null;
  check(`authorization for ${doc.client_name} (${CLAUDE_CODE}) reaches the sign-in at the provider`,
    target?.origin === new URL(ISSUER).origin && target.searchParams.get('redirect_uri') === `${PUBLIC}/oauth/callback`,
    hops.join(', '));
}

async function serviceStep() {
  need(ctx.ontologyCreated && ctx.admin, 'needs the e2e ontology');
  const token = await serviceToken();
  const before = await call(BASE, 'GET', `${runtime(ctx.lensA)}/entities/${ctx.type}?limit=1`, { token });
  check('service token before admission → 403/404', isOneOf(before, 403, 404), said(before));
  // Its first call provisioned a role-less user; admission makes that user the service
  // principal (a rerun finds it admitted already: 409).
  const admitted = await asAdmin('POST', '/api/users', { kind: 'service', displayName: 'E2E service', subject: subject('service') });
  const user = (await me({ token })).json?.user ?? null;
  const id = user?.id ?? null;
  check('administrator admits it: a service principal', isOneOf(admitted, 201, 409) && user?.kind === 'service',
    `${said(admitted)}, user ${id}, kind ${user?.kind}`);
  need(id, 'no service principal');
  const r = await grant('service', id, { role: 'reader', ontologyKey: ctx.ontology, lensKey: ctx.lensA });
  check('administrator grants it reader on lens A', r.status === 201, `${said(r)}, assignment ${r.json?.id}`);
  const after = await call(BASE, 'GET', `${runtime(ctx.lensA)}/entities/${ctx.type}?limit=1`, { token });
  check('service token after the grant → 200', after.status === 200, said(after));
}

async function mcpStep() {
  need(ctx.ontologyCreated && ctx.grants.reader, 'needs the e2e ontology and the reader grant');
  const mount = mountUrl(ctx.lensA);
  const initialize = {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } },
  };
  const post = (token) => call(mount, 'POST', '', { body: initialize, token, headers: { accept: 'application/json, text/event-stream' } });
  const anonymous = await post();
  const header = anonymous.headers.get('www-authenticate') ?? '';
  const metadataUrl = /resource_metadata="([^"]+)"/.exec(header)?.[1];
  check('unauthenticated MCP call → 401 with resource_metadata', anonymous.status === 401 && !!metadataUrl,
    `${said(anonymous)}, WWW-Authenticate ${header || 'absent'}`);
  if (metadataUrl) {
    const doc = await fetch(metadataUrl).then(async (res) => ({ status: res.status, json: await res.json().catch(() => null) }), () => ({ status: 0 }));
    check('protected-resource metadata names this server and this mount',
      doc.status === 200 && JSON.stringify(doc.json?.authorization_servers) === JSON.stringify([PUBLIC]) && doc.json?.resource === mount,
      `HTTP ${doc.status}, resource ${doc.json?.resource}, authorization_servers ${JSON.stringify(doc.json?.authorization_servers)}`);
  }

  const mcp = await connectMcp(mount, 'reader');
  try {
    const asked = mcp.authorizationUrl.searchParams;
    check('MCP SDK client authorized as reader with the configured client (discovery, sign-in, consent, code + PKCE)',
      asked.get('client_id') === 'ontoforge-cli' && asked.get('resource') === mount && isOpaque(mcp.tokens()?.access_token),
      `client_id ${asked.get('client_id')}, resource ${asked.get('resource')}, scope ${asked.get('scope') ?? 'none sent'}, opaque token ${isOpaque(mcp.tokens()?.access_token)}`);
    const { tools } = await mcp.client.listTools();
    const names = tools.map((t) => t.name);
    const writes = names.filter((n) => WRITE_TOOLS.has(n));
    check('reader lists only read tools', names.includes('get_schema') && writes.length === 0,
      `${names.length} tools, write tools ${JSON.stringify(writes)}`);
    const read = await mcp.client.callTool({ name: 'list_entities', arguments: { entity_type_key: ctx.type } });
    check('read tool list_entities succeeds', !read.isError, read.isError ? text(read) : 'isError false');
    let refusal;
    try {
      const write = await mcp.client.callTool({ name: 'create_entity', arguments: { entity_type_key: ctx.type, properties: { name: `mcp ${stamp}` } } });
      refusal = write.isError ? `isError: ${text(write)}` : null;
    } catch (error) {
      refusal = `error: ${String(error?.message ?? error).slice(0, 160)}`;
    }
    check('write tool create_entity is refused', refusal !== null, refusal ?? 'the entity was created');

    const mountToken = mcp.tokens().access_token;
    const onRest = await call(BASE, 'GET', '/api/ontologies', { token: mountToken });
    const restOnMount = await post(ctx.tokens.reader);
    const otherLens = await call(mountUrl(ctx.lensB), 'POST', '', { body: initialize, token: mountToken, headers: { accept: 'application/json, text/event-stream' } });
    check('a token works on its resource only: mount token on REST, REST token on the mount, mount token on another mount → 401',
      onRest.status === 401 && restOnMount.status === 401 && otherLens.status === 401,
      `REST ${said(onRest)}, mount ${said(restOnMount)}, lens B mount ${said(otherLens)}`);
  } finally {
    await mcp.close();
  }

  const cli = await ontoforgeTokens('reader', mount);
  const listed = (await listTools(mount, cli.access_token)).map((t) => t.name);
  check('command-line client for the mount (--mcp) lists the same read tools', listed.includes('get_schema') && !listed.some((n) => WRITE_TOOLS.has(n)),
    `${listed.length} tools`);
}

const WRITE_TOOLS = new Set([
  'create_entity', 'update_entity', 'edit_document', 'write_document', 'delete_entity', 'create_relation',
  'update_relation', 'delete_relation', 'start_changeset', 'unstage', 'rebase', 'submit_changeset',
  'unsubmit_changeset', 'check_changeset', 'commit_changeset', 'discard_changeset',
]);
const text = (result) => (result.content ?? []).map((c) => c.text ?? '').join(' ').slice(0, 160);

async function revokeStep() {
  need(ctx.grants.reader && ctx.tokens.reader, 'needs the reader grant and token');
  const { userId, assignmentId } = ctx.grants.reader;
  const r = await asAdmin('DELETE', `/api/users/${userId}/assignments/${assignmentId}`);
  check('administrator revokes reader on lens A', r.status === 204, said(r));
  const next = await call(BASE, 'GET', `${runtime(ctx.lensA)}/entities/${ctx.type}?limit=1`, { token: ctx.tokens.reader });
  check("reader's next request is refused (same token)", isOneOf(next, 403, 404), said(next));
}

async function disableStep() {
  need(ctx.users.writer && ctx.tokens.writer, 'needs the writer and its token');
  const id = ctx.users.writer;
  const auth = { token: ctx.tokens.writer };
  const off = await asAdmin('PATCH', `/api/users/${id}`, { status: 'disabled' });
  check('administrator disables writer', off.status === 200 && off.json?.status === 'disabled', `${said(off)}, status ${off.json?.status}`);
  try {
    const read = await call(BASE, 'GET', `${runtime(ctx.lensA)}/entities/${ctx.type}?limit=1`, auth);
    check("writer's next request with its live OntoForge token → 403", read.status === 403, said(read));
    const refreshed = await oauthToken(PUBLIC, { grant_type: 'refresh_token', refresh_token: ctx.tokens.writerRefresh, client_id: 'ontoforge-cli', resource: API });
    check('writer gets no new token by refresh', refreshed.status === 400 && refreshed.json?.error === 'invalid_grant',
      `HTTP ${refreshed.status} ${refreshed.json?.error}`);
    const authorized = await authorizeInBrowser((await authorizationRequest(PUBLIC, { resource: API })).url, 'writer');
    check('writer is refused at a new authorization', authorized.page?.status === 403 && authorized.redirect === null,
      authorized.page ? `HTTP ${authorized.page.status} ${authorized.page.message}` : `redirect ${authorized.redirect}`);
    const login = await browserLogin('writer');
    check('writer browser sign-in → /?login=disabled, no session', target(login.location) === '/?login=disabled' && login.me.json?.user === null,
      `HTTP ${login.status} → ${login.location}, user ${JSON.stringify(login.me.json?.user)}`);
  } finally {
    const on = await asAdmin('PATCH', `/api/users/${id}`, { status: 'active' });
    check('administrator enables writer again', on.status === 200 && on.json?.status === 'active', `${said(on)}, status ${on.json?.status}`);
  }
  const write = await call(BASE, 'POST', `${runtime(ctx.lensA)}/entities/${ctx.type}`, { ...auth, body: { name: `after enable ${stamp}` } });
  check('writer writes again after enabling', write.status === 201, said(write));
}

async function usersStep() {
  need(ctx.admin, 'needs the administrator session');
  const all = await asAdmin('GET', '/api/users?limit=50&offset=0');
  check('list users', all.status === 200 && Array.isArray(all.json?.items) && typeof all.json?.total === 'number',
    `${said(all)}, total ${all.json?.total}, page ${all.json?.items?.length}`);
  const search = await findUsers('reader');
  check('search users', search.status === 200 && search.items.some((u) => u.username === 'reader'),
    `HTTP ${search.status}, ${search.items.length} match(es): ${search.items.map((u) => u.username).join(', ')}`);
  if (ctx.users.writer) {
    const one = await asAdmin('GET', `/api/users/${ctx.users.writer}`);
    const writerRoles = (one.json?.assignments ?? []).filter((a) => a.ontologyKey === ctx.ontology).map((a) => `${a.role}@${a.lensKey}`);
    check('one user with its assignments', one.status === 200 && writerRoles.includes(`writer@${ctx.lensA}`), `${said(one)}, ${JSON.stringify(writerRoles)}`);
  }
  if (ctx.ontologyCreated) {
    const access = await asAdmin('GET', `/api/ontologies/${ctx.ontology}/access`);
    const rows = (access.json?.assignments ?? []).map((a) => `${a.user?.username ?? a.user?.displayName}:${a.role}@${a.lensKey ?? '-'}`);
    check("the ontology's access list", access.status === 200 && rows.some((r) => r.startsWith('writer:writer')), `${said(access)}, ${JSON.stringify(rows)}`);
  }
  if (ctx.tokens.writer) {
    const denied = await call(BASE, 'GET', '/api/users', { token: ctx.tokens.writer });
    check('a writer (no administrator) may not list users', denied.status === 403, said(denied));
  }
}

async function expiryStep() {
  need(IDLE !== null, 'pass --idle-seconds N for a server started with AUTH_SESSION_IDLE_SECONDS=N');
  const seconds = Number(IDLE);
  const { jar, me: before } = await browserLogin('newcomer');
  need(before.json?.user, 'newcomer could not sign in');
  console.log(`    · waiting ${seconds + 2} s without a request`);
  await sleep((seconds + 2) * 1000);
  const after = await me({ jar });
  check(`idle session expired after ${seconds + 2} s`, after.status === 200 && after.json?.user === null, `${said(after)}, user ${JSON.stringify(after.json?.user)}`);
  const protectedCall = await call(BASE, 'GET', '/api/ontologies', { jar });
  check('expired session: protected route → 401', protectedCall.status === 401, said(protectedCall));
}

async function cleanupStep() {
  need(ctx.admin, 'needs the administrator session');
  if (ctx.ontologyCreated) {
    const r = await asAdmin('DELETE', `/api/ontologies/${ctx.ontology}`);
    check(`delete ${ctx.ontology}`, r.status === 204, said(r));
  }
  if (ctx.creatorGranted) {
    const r = await asAdmin('DELETE', `/api/users/${ctx.admin.id}/assignments/${ctx.creatorGranted}`);
    check("revoke the administrator's ontology_creator again", r.status === 204, said(r));
  }
}

const STEPS = [
  ['server', serverStep],
  ['browser sign-in (admin)', adminStep],
  ['first and repeat sign-in (newcomer)', newcomerStep],
  ['concurrent first sign-ins', concurrentStep],
  ['logout and CSRF', logoutStep],
  ['CSRF on another route', csrfStep],
  ['setup: ontology, lenses, roles', setupStep],
  ['authorization server', authorizationServerStep],
  ['command-line client', cliStep],
  ['REST with bearer tokens', restStep],
  ['refresh rotation', rotationStep],
  ['consent: Origin and Deny', consentStep],
  ['a client metadata document (online)', clientDocumentStep],
  ['service principal', serviceStep],
  ['MCP for a person', mcpStep],
  ['revocation', revokeStep],
  ['disabling', disableStep],
  ['user management', usersStep],
  ['session expiry', expiryStep],
  ['cleanup', cleanupStep],
];

// --- Main --------------------------------------------------------------------------------

console.log(`Authentication e2e: web client ${BASE}, server ${PUBLIC}, run ${stamp}`);
const probe = await me({});
if (probe.status !== 200 || probe.json?.authentication !== true) {
  console.error(probe.status === 0
    ? `No server at ${BASE} (${probe.text}).`
    : `The server at ${BASE} runs without authentication (/api/auth/me: ${said(probe)}, ${probe.text.slice(0, 120)}).`);
  process.exit(2);
}

for (const [name, step] of STEPS) {
  console.log(`\n${name}`);
  try {
    await step();
  } catch (error) {
    if (error instanceof Skip) skip(name, error.message);
    else check(`${name} ran`, false, String(error?.message ?? error));
  }
}

console.log(`\n${totals.PASS} passed, ${totals.FAIL} failed, ${totals.SKIP} skipped`);
process.exit(totals.FAIL > 0 ? 1 : 0);
