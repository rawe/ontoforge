#!/usr/bin/env node
// End-to-end check of authentication against a running server with AUTH_ENABLED=true and the
// development Keycloak: browser sign-in, sessions, CSRF, bearer tokens, roles, revocation,
// disabling, user management and MCP OAuth with a real MCP SDK client. See USAGE.md.
//
//   node scripts/auth/e2e.mjs [--base http://localhost:5173] [--public-url http://localhost:8000]
//                             [--idle-seconds N] [--no-fresh-user]
//
// Prints PASS, FAIL or SKIP per check with its evidence (statuses, ids — never a token or a
// password); exit 1 when a check failed, 2 when the server cannot be checked at all. It
// creates the ontology e2e_auth_<random> and deletes it at the end.

import { randomBytes } from 'node:crypto';
import {
  AUDIENCE, ISSUER, appLogin, call, claims, connectMcp, createKeycloakUser, deleteKeycloakUser, deliverCallback,
  forgedExpiredToken, foreignIssuerToken, idToken, serviceToken, startAppLogin, subject, userToken, userTokens,
} from './lib.mjs';

const option = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
};
// The web client's address (WEB_CLIENT_URL): browser sign-in, cookies and REST go here.
const BASE = option('--base', 'http://localhost:5173').replace(/\/$/, '');
const ORIGIN = new URL(BASE).origin;
// The server's address (PUBLIC_URL): MCP clients connect and sign in here.
const PUBLIC = option('--public-url', 'http://localhost:8000').replace(/\/$/, '');
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
  check('repeat sign-in reuses the user', again.me.json?.user?.id === user?.id && count === 1,
    `first ${user?.id}, repeat ${again.me.json?.user?.id}, ${count} user(s) named newcomer`);
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

async function restStep() {
  need(ctx.ontologyCreated, 'needs the e2e ontology');
  need(ctx.grants.reader && ctx.grants.writer, 'needs the reader and writer grants');
  ctx.tokens.reader = await userToken('reader');
  ctx.tokens.writer = await userToken('writer');
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
  const plain = (await userTokens('reader', { scope: 'openid' })).access_token;
  await challenged(`token without audience ${AUDIENCE} (aud ${JSON.stringify(claims(plain).aud)}) → 401`, plain);
  await challenged('garbage token → 401', 'not-a-token');
  await challenged('forged expired token → 401', forgedExpiredToken());
  await challenged('ID token as bearer → 401', await idToken('reader'));
  const foreign = await foreignIssuerToken();
  await challenged(`token of another issuer (${claims(foreign).iss}) → 401`, foreign);
  const tampered = ctx.tokens.reader.slice(0, -4) + (ctx.tokens.reader.endsWith('AAAA') ? 'BBBB' : 'AAAA');
  await challenged('reader token with a broken signature → 401', tampered);
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
  const mount = `/mcp/ontologies/${ctx.ontology}/runtime/lenses/${ctx.lensA}`;
  const initialize = {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } },
  };
  const anonymous = await call(PUBLIC, 'POST', mount, { body: initialize, headers: { accept: 'application/json, text/event-stream' } });
  const header = anonymous.headers.get('www-authenticate') ?? '';
  const metadataUrl = /resource_metadata="([^"]+)"/.exec(header)?.[1];
  check('unauthenticated MCP call → 401 with resource_metadata', anonymous.status === 401 && !!metadataUrl,
    `${said(anonymous)}, WWW-Authenticate ${header || 'absent'}`);
  if (metadataUrl) {
    const doc = await fetch(metadataUrl).then(async (res) => ({ status: res.status, json: await res.json().catch(() => null) }), () => ({ status: 0 }));
    check('protected-resource metadata names the issuer and this mount',
      doc.status === 200 && doc.json?.authorization_servers?.includes(ISSUER) && doc.json?.resource === `${PUBLIC}${mount}`,
      `HTTP ${doc.status}, resource ${doc.json?.resource}, authorization_servers ${JSON.stringify(doc.json?.authorization_servers)}, scopes ${JSON.stringify(doc.json?.scopes_supported)}`);
  }

  const mcp = await connectMcp(`${PUBLIC}${mount}`, 'reader');
  try {
    check('MCP SDK client authorized as reader (discovery, registration, consent, code + PKCE)', true,
      `registered client ${mcp.registration.clientId ?? 'unknown'}`);
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
  } finally {
    await mcp.close();
    console.log(`    · cleanup: MCP session closed, registered Keycloak client ${mcp.registration.uri ? 'deleted' : 'unknown'}`);
  }
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
    check("writer's next request → 403", read.status === 403, said(read));
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
  ['REST with bearer tokens', restStep],
  ['service principal', serviceStep],
  ['MCP OAuth', mcpStep],
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
