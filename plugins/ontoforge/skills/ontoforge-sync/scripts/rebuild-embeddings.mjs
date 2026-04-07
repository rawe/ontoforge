#!/usr/bin/env node
// Rebuild all embedding vectors for semantic search via the OntoForge API.

import { die, getBaseUrl, parseCliArgs } from './lib.mjs';

const { flags } = parseCliArgs({
  baseUrl: ['--base-url'],
});

const baseUrl = getBaseUrl(flags);
const url = `${baseUrl}/api/model/rebuild-embeddings`;

let res;
try {
  res = await fetch(url, { method: 'POST' });
} catch {
  die(`Cannot connect to ${baseUrl}. Is the OntoForge server running?`);
}

if (!res.ok) {
  const text = await res.text();
  die(`POST /api/model/rebuild-embeddings -> ${res.status}: ${text}`);
}

// Stream NDJSON response line by line
const decoder = new TextDecoder();
let buffer = '';

for await (const chunk of res.body) {
  buffer += decoder.decode(chunk, { stream: true });
  let newlineIdx;
  while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newlineIdx).trim();
    buffer = buffer.slice(newlineIdx + 1);
    if (!line) continue;

    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    if (event.type === 'progress') {
      console.error(`  ${event.entityTypeKey}: ${event.processed}/${event.total}`);
    } else if (event.type === 'summary') {
      console.error('');
      console.error('Rebuild complete:');
      for (const et of event.entityTypes) {
        const status = et.failed ? ` (${et.failed} failed)` : '';
        console.error(`  ${et.entityTypeKey}: ${et.processed} embedded${status}`);
      }
      const sqFailed = event.savedQueriesFailed
        ? ` (${event.savedQueriesFailed} failed)`
        : '';
      console.error(`  saved_queries: ${event.savedQueriesProcessed} embedded${sqFailed}`);
      console.error(
        `  Total: ${event.totalProcessed} processed, ${event.totalFailed} failed`,
      );
    }
  }
}
