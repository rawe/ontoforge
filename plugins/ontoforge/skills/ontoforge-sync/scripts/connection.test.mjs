// Tests for connection.mjs: node --test connection.test.mjs
// Each case runs a script in a child process, so the module's once-per-process
// token resolution starts fresh.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const TOKEN = 'test-token-123';

// A server with authentication enabled: answers 401 unless the token matches,
// and redirects /moved elsewhere.
function startServer() {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push(req.headers.authorization ?? null);
    if (req.url === '/moved') {
      res.writeHead(302, { Location: 'http://example.invalid/' }).end();
    } else if (req.headers.authorization === `Bearer ${TOKEN}`) {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
    } else {
      res.writeHead(401).end();
    }
  });
  return new Promise((done) =>
    server.listen(0, '127.0.0.1', () =>
      done({ server, seen, baseUrl: `http://127.0.0.1:${server.address().port}` }),
    ),
  );
}

function run(baseUrl, path, env) {
  const script = `
    import { serverFetch } from ${JSON.stringify(join(here, 'connection.mjs'))};
    try {
      const res = await serverFetch(${JSON.stringify(baseUrl)}, ${JSON.stringify(path)});
      console.log('status', res.status);
    } catch (err) {
      console.log('error', err.message);
    }`;
  const clean = { ...process.env };
  delete clean.ONTOFORGE_BASE_URL;
  delete clean.ONTOFORGE_API_TOKEN;
  delete clean.ONTOFORGE_ENV_FILE;
  return new Promise((done) =>
    execFile(
      process.execPath,
      ['--input-type=module', '-e', script],
      { env: { ...clean, ...env } },
      (_, stdout, stderr) => done({ stdout, stderr }),
    ),
  );
}

test('sends no header without a token, and says where the token comes from on 401', async () => {
  const srv = await startServer();
  const { stdout } = await run(srv.baseUrl, '/x', {});
  srv.server.close();
  assert.equal(srv.seen[0], null);
  assert.match(stdout, /authentication enabled.*ONTOFORGE_API_TOKEN/);
});

test('sends the token from ONTOFORGE_API_TOKEN and never prints it', async () => {
  const srv = await startServer();
  const { stdout, stderr } = await run(srv.baseUrl, '/x', { ONTOFORGE_API_TOKEN: TOKEN });
  srv.server.close();
  assert.equal(srv.seen[0], `Bearer ${TOKEN}`);
  assert.match(stdout, /status 200/);
  assert.match(stderr, /Token: from ONTOFORGE_API_TOKEN/);
  assert.ok(!(stdout + stderr).includes(TOKEN));
});

test('ONTOFORGE_ENV_FILE wins over the variable, as KEY=value or a bare token', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ontoforge-conn-'));
  const envFile = join(dir, 'a.env');
  const bareFile = join(dir, 'token');
  writeFileSync(envFile, `OTHER=1\nexport ONTOFORGE_API_TOKEN="${TOKEN}"\n`);
  writeFileSync(bareFile, `${TOKEN}\n`);
  const srv = await startServer();
  const a = await run(srv.baseUrl, '/x', { ONTOFORGE_ENV_FILE: envFile, ONTOFORGE_API_TOKEN: 'wrong' });
  const b = await run(srv.baseUrl, '/x', { ONTOFORGE_ENV_FILE: bareFile });
  srv.server.close();
  assert.match(a.stdout, /status 200/);
  assert.match(b.stdout, /status 200/);
  assert.ok(!(a.stdout + a.stderr + b.stdout + b.stderr).includes(TOKEN));
});

test('refuses a redirect while a token is set', async () => {
  const srv = await startServer();
  const { stdout } = await run(srv.baseUrl, '/moved', { ONTOFORGE_API_TOKEN: TOKEN });
  srv.server.close();
  assert.match(stdout, /302 redirect refused/);
});

function resolve(flag, env) {
  const script = `
    import { resolveBaseUrl } from ${JSON.stringify(join(here, 'connection.mjs'))};
    try {
      console.log('url', resolveBaseUrl(${JSON.stringify(flag)}));
    } catch (err) {
      console.log('error', err.message);
    }`;
  const clean = { ...process.env };
  delete clean.ONTOFORGE_BASE_URL;
  delete clean.ONTOFORGE_API_TOKEN;
  delete clean.ONTOFORGE_ENV_FILE;
  return new Promise((done) =>
    execFile(
      process.execPath,
      ['--input-type=module', '-e', script],
      { env: { ...clean, ...env } },
      (_, stdout, stderr) => done({ stdout, stderr }),
    ),
  );
}

test('base URL: flag, then ONTOFORGE_ENV_FILE, then ONTOFORGE_BASE_URL, then localhost', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ontoforge-url-'));
  const profile = join(dir, 'remote.env');
  writeFileSync(profile, `ONTOFORGE_BASE_URL=https://remote.example/\nONTOFORGE_API_TOKEN=${TOKEN}\n`);
  const env = { ONTOFORGE_BASE_URL: 'http://env.example' };

  const local = await resolve(undefined, {});
  assert.match(local.stdout, /url http:\/\/localhost:8000/);
  assert.match(local.stderr, /Server: http:\/\/localhost:8000 \(from default, the local server\)/);
  assert.match((await resolve(undefined, env)).stdout, /url http:\/\/env\.example/);
  const fromFile = await resolve(undefined, { ...env, ONTOFORGE_ENV_FILE: profile });
  assert.match(fromFile.stdout, /url https:\/\/remote\.example$/m);
  assert.ok(!(fromFile.stdout + fromFile.stderr).includes(TOKEN));
  assert.match((await resolve('http://flag.example', { ...env, ONTOFORGE_ENV_FILE: profile })).stdout, /url http:\/\/flag\.example/);
  assert.match((await resolve('ftp://x', {})).stdout, /error base URL must be http or https/);
});

test('a profile with only a base URL leaves the token to ONTOFORGE_API_TOKEN', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ontoforge-url-'));
  const profile = join(dir, 'open.env');
  writeFileSync(profile, 'ONTOFORGE_BASE_URL=http://127.0.0.1:1\n');
  const srv = await startServer();
  const { stdout } = await run(srv.baseUrl, '/x', { ONTOFORGE_ENV_FILE: profile, ONTOFORGE_API_TOKEN: TOKEN });
  srv.server.close();
  assert.match(stdout, /status 200/);
});

test('every skill carries the same connection.mjs', () => {
  const copy = (skill) => readFileSync(join(here, '..', '..', skill, 'scripts', 'connection.mjs'), 'utf8');
  assert.equal(copy('ontoforge-okf'), copy('ontoforge-sync'));
  assert.equal(copy('ontoforge-document'), copy('ontoforge-sync'));
});
