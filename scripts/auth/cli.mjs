#!/usr/bin/env node
// A command-line tool signing a person in to OntoForge — the reference for building an own
// tool. OAuth 2.1 authorization code + PKCE with a loopback redirect (RFC 8252), against
// OntoForge's own authorization server. Node 22, no dependencies. See USAGE.md.
//
//   node scripts/auth/cli.mjs [--server http://localhost:8000] [--client-id ontoforge-cli]
//   node scripts/auth/cli.mjs --mcp http://localhost:8000/mcp/ontologies/<key>/runtime/lenses/<lens>
//
// Without --mcp it asks for the REST API (resource PUBLIC_URL/api) and prints who is signed
// in (GET /api/auth/me). With --mcp it asks for that one MCP mount and lists its tools.
//
// The client ID must be known to the server: an entry of OAUTH_CLIENTS with the redirect URI
// http://127.0.0.1/callback (any port matches a loopback redirect). The client is public: no
// secret, PKCE instead. It sends no scope — the person's roles decide what the token may
// do — and names exactly one resource, which is all the token opens. Tokens stay in memory.

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

/** POSTs a form and answers its JSON; throws with the server's OAuth error. */
async function postForm(url, fields) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${url} answered ${response.status} ${json.error ?? ''} ${json.error_description ?? ''}`.trim());
  return json;
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
}

/**
 * Discovery: the resource's protected-resource metadata (RFC 9728) names its authorization
 * server; that server's metadata (RFC 8414) names the endpoints.
 */
export async function discover(resource) {
  const { origin, pathname } = new URL(resource);
  const protectedResource = await getJson(`${origin}/.well-known/oauth-protected-resource${pathname}`);
  const issuer = new URL(protectedResource.authorization_servers[0]);
  const path = issuer.pathname === '/' ? '' : issuer.pathname;
  return getJson(`${issuer.origin}/.well-known/oauth-authorization-server${path}`);
}

/** Opens a URL in the person's browser. */
function openBrowser(url) {
  const [command, ...args] = process.platform === 'darwin' ? ['open'] : process.platform === 'win32' ? ['cmd', '/c', 'start', ''] : ['xdg-open'];
  spawn(command, [...args, url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

/**
 * Signs the person in for `resource` and answers the token response
 * ({access_token, refresh_token, expires_in, …}). `openUrl` receives the authorization URL;
 * it opens the browser by default (a test hands it to a scripted browser instead).
 */
export async function signIn({ resource, clientId = 'ontoforge-cli', openUrl = openBrowser }) {
  const metadata = await discover(resource);

  // 1. A loopback listener on a free port receives the browser's redirect with the code.
  let receive;
  const received = new Promise((resolve) => { receive = resolve; });
  const listener = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname !== '/callback') { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': 'text/plain' }).end('Done. You can close this window.');
    receive(url.searchParams);
  });
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const redirectUri = `http://127.0.0.1:${listener.address().port}/callback`;

  try {
    // 2. PKCE: a random verifier, its SHA-256 as the challenge. `state` ties the answer to this request.
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const state = randomBytes(16).toString('base64url');

    // 3. The browser goes to the authorization endpoint: the person signs in at the identity
    //    provider and allows this client on OntoForge's consent page.
    const authorization = new URL(metadata.authorization_endpoint);
    authorization.search = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      resource,
    }).toString();
    await openUrl(authorization.href);

    // 4. The redirect arrives with a code (Allow) or an error (Deny, or a refused request).
    const answer = await received;
    if (answer.get('state') !== state) throw new Error('the answer belongs to another request (state differs)');
    if (answer.get('error')) throw new Error(`authorization refused: ${answer.get('error')} ${answer.get('error_description') ?? ''}`.trim());

    // 5. The code, the verifier and the same resource buy the tokens.
    return await postForm(metadata.token_endpoint, {
      grant_type: 'authorization_code',
      code: answer.get('code'),
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
      resource,
    });
  } finally {
    listener.close();
  }
}

/**
 * A new token pair for a refresh token. The refresh token rotates: use the new one next time;
 * the old one is spent, and presenting it again revokes the whole authorization.
 */
export async function refresh({ resource, refreshToken, clientId = 'ontoforge-cli' }) {
  const metadata = await discover(resource);
  return postForm(metadata.token_endpoint, { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, resource });
}

/** The tools of an MCP mount: initialize, then tools/list (Streamable HTTP, JSON-RPC). */
export async function listTools(mount, accessToken) {
  let id = 0;
  const rpc = async (method, params, notification = false) => {
    const response = await fetch(mount, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-06-18',
      },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, ...(notification ? {} : { id: ++id }) }),
    });
    if (!response.ok) throw new Error(`${method} answered ${response.status}`);
    if (notification) return null;
    // A server may answer as an event stream: the message is its `data:` line.
    const text = await response.text();
    const body = JSON.parse(response.headers.get('content-type')?.includes('text/event-stream') ? /^data: (.*)$/m.exec(text)[1] : text);
    if (body.error) throw new Error(`${method}: ${body.error.message}`);
    return body.result;
  };
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'ontoforge-cli', version: '1.0.0' } });
  await rpc('notifications/initialized', {}, true);
  return (await rpc('tools/list', {})).tools;
}

async function main() {
  const option = (name, fallback) => {
    const i = process.argv.indexOf(name);
    return i < 0 ? fallback : process.argv[i + 1];
  };
  const server = option('--server', 'http://localhost:8000').replace(/\/$/, '');
  const clientId = option('--client-id', 'ontoforge-cli');
  const mount = option('--mcp', null);
  const resource = mount ?? `${server}/api`;

  const tokens = await signIn({
    resource,
    clientId,
    openUrl: (url) => {
      console.log(`Opening the browser to sign in. If it does not open, visit:\n  ${url}`);
      openBrowser(url);
    },
  });

  if (mount) {
    const tools = await listTools(mount, tokens.access_token);
    console.log(`${tools.length} tools on ${mount}:`);
    for (const tool of tools) console.log(`  ${tool.name}`);
    return;
  }
  const response = await fetch(`${server}/api/auth/me`, { headers: { authorization: `Bearer ${tokens.access_token}` } });
  const me = await response.json();
  if (!response.ok || !me.user) throw new Error(`/api/auth/me answered ${response.status}`);
  const roles = me.assignments.map((a) => [a.role, a.ontologyKey, a.lensKey].filter(Boolean).join(' @ '));
  console.log(`Signed in as ${me.user.displayName} (${me.user.username ?? me.user.id})`);
  console.log(`Roles: ${roles.length ? roles.join(', ') : 'none assigned'}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Sign-in failed: ${error.message}`);
    process.exit(1);
  });
}
