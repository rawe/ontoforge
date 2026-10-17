#!/usr/bin/env node
// Rebuild one ontology's search data outside its search indices: the
// saved-query description vectors and their vector index. Search indices
// rebuild themselves.

import { serverFetch } from './connection.mjs';
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
  res = await serverFetch(baseUrl, path, { method: 'POST' });
} catch (err) {
  die(err.message);
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
