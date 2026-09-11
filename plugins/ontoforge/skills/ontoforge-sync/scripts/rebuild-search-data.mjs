#!/usr/bin/env node
// Rebuild one ontology's search data: keyword text, document passages and,
// where an embedding provider is configured, vectors and vector indexes.

import { die, getBaseUrl, getOntologyKey, modelPath, parseCliArgs } from './lib.mjs';

const { flags } = parseCliArgs({
  baseUrl: ['--base-url'],
  ontology: ['--ontology'],
});

const baseUrl = getBaseUrl(flags);
const ontologyKey = getOntologyKey(flags);
const path = `${modelPath(ontologyKey)}/rebuild-search-data`;

let res;
try {
  res = await fetch(`${baseUrl}${path}`, { method: 'POST' });
} catch {
  die(`Cannot connect to ${baseUrl}. Is the OntoForge server running?`);
}

if (!res.ok) {
  const text = await res.text();
  die(`POST ${path} -> ${res.status}: ${text}`);
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
        console.error(`  ${et.entityTypeKey}: ${et.processed} rebuilt${status}`);
      }
      const sqFailed = event.savedQueriesFailed
        ? ` (${event.savedQueriesFailed} failed)`
        : '';
      console.error(`  saved_queries: ${event.savedQueriesProcessed} embedded${sqFailed}`);
      console.error(
        `  Total: ${event.totalProcessed} processed, ${event.totalFailed} failed`,
      );
      if (event.embeddingsSkipped) {
        console.error('  Embeddings skipped: no embedding provider configured.');
      }
    }
  }
}
