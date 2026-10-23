#!/usr/bin/env node
// Deterministic stand-in for the Ollama endpoints the server calls, for the
// shared-state harness (docker/scale/compose.yml). Node only, no dependencies.
//
//   POST /v1/chat/completions   OpenAI-compatible chat (JSON, or SSE with stream:true).
//                               Answers "user-messages:<count of role=user messages>"
//                               and never calls a tool, so a second turn answered
//                               "user-messages:2" proves the model saw the first one.
//   POST /api/embed             Ollama's native embeddings: one vector per input,
//                               seeded by the text, so equal texts get equal vectors.
//   GET  /control               The current settings and call counters.
//   POST /control               Change settings: {chatDelayMs, holdEmbed, dimensions}.
//                               holdEmbed:true parks every embed call until holdEmbed:false.
//   GET  /  and  /api/tags      Liveness, as Ollama answers them.
//
// Listens on PORT (default 11434).

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

const state = { chatDelayMs: 0, holdEmbed: false, dimensions: 16 };
const counters = { chat: 0, embed: 0, embedTexts: 0, held: 0 };
let held = [];

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let text = '';
  for await (const chunk of req) text += chunk;
  return text ? JSON.parse(text) : {};
}

// Resolves false when the caller hangs up first (the response closes unsent).
function wait(ms, res) {
  return new Promise((resolve) => {
    if (ms <= 0) return resolve(true);
    const timer = setTimeout(() => resolve(true), ms);
    res.once('close', () => { clearTimeout(timer); resolve(false); });
  });
}

function vector(text, dimensions) {
  const out = [];
  let seed = createHash('sha256').update(text).digest();
  while (out.length < dimensions) {
    for (let i = 0; i + 4 <= seed.length && out.length < dimensions; i += 4) {
      out.push(seed.readUInt32BE(i) / 0xffffffff - 0.5);
    }
    seed = createHash('sha256').update(seed).digest();
  }
  const norm = Math.hypot(...out) || 1;
  return out.map((v) => v / norm);
}

async function chat(req, res) {
  const body = await readJson(req);
  counters.chat++;
  const users = (body.messages ?? []).filter((m) => m.role === 'user').length;
  const content = `user-messages:${users}`;
  if (!(await wait(state.chatDelayMs, res))) return;
  const id = `chatcmpl-fake-${counters.chat}`;
  const created = Math.floor(Date.now() / 1000);
  const model = body.model ?? 'fake-chat';
  const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };
  if (!body.stream) {
    return send(res, 200, {
      id, object: 'chat.completion', created, model,
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage,
    });
  }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const chunk = (delta, finish) => res.write(`data: ${JSON.stringify({
    id, object: 'chat.completion.chunk', created, model,
    choices: [{ index: 0, delta, finish_reason: finish }],
    ...(finish ? { usage } : {}),
  })}\n\n`);
  chunk({ role: 'assistant', content }, null);
  chunk({}, 'stop');
  res.end('data: [DONE]\n\n');
}

async function embed(req, res) {
  const body = await readJson(req);
  counters.embed++;
  const input = Array.isArray(body.input) ? body.input : [body.input ?? ''];
  if (state.holdEmbed) {
    counters.held++;
    const released = await new Promise((resolve) => {
      held.push(resolve);
      res.once('close', () => resolve(false));
    });
    if (!released) return;
  }
  counters.embedTexts += input.length;
  send(res, 200, {
    model: body.model ?? 'fake-embed',
    embeddings: input.map((text) => vector(String(text), state.dimensions)),
  });
}

async function control(req, res) {
  if (req.method === 'POST') {
    const body = await readJson(req);
    if (body.chatDelayMs !== undefined) state.chatDelayMs = Number(body.chatDelayMs);
    if (body.dimensions !== undefined) state.dimensions = Number(body.dimensions);
    if (body.holdEmbed !== undefined) {
      state.holdEmbed = Boolean(body.holdEmbed);
      if (!state.holdEmbed) {
        const waiting = held;
        held = [];
        for (const resolve of waiting) resolve(true);
      }
    }
  }
  send(res, 200, { ...state, counters, waiting: held.length });
}

const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://fake').pathname;
  const route =
    req.method === 'POST' && path === '/v1/chat/completions' ? chat
    : req.method === 'POST' && path === '/api/embed' ? embed
    : path === '/control' ? control
    : req.method === 'GET' && path === '/api/tags' ? (_q, r) => send(r, 200, { models: [{ name: 'fake-chat' }, { name: 'fake-embed' }] })
    : req.method === 'GET' && path === '/' ? (_q, r) => { r.writeHead(200); r.end('Ollama is running'); }
    : null;
  if (route === null) return send(res, 404, { error: `not found: ${req.method} ${path}` });
  Promise.resolve(route(req, res)).catch((error) => {
    if (!res.headersSent) send(res, 400, { error: String(error?.message ?? error) });
  });
});

const port = Number(process.env.PORT ?? 11434);
server.listen(port, () => console.log(`fake-ollama listening on ${port}`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
