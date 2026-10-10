#!/usr/bin/env node
// Import an ontology design from a JSON file into one existing ontology.

import { readFileSync } from 'node:fs';
import { api, die, getBaseUrl, getOntologyKey, modelPath, parseCliArgs } from './lib.mjs';

const { flags, positional } = parseCliArgs({
  baseUrl: ['--base-url'],
  ontology: ['--ontology'],
});

const file = positional[0];
if (!file) {
  die('Usage: node import-schema.mjs <file> [--base-url URL] [--ontology KEY]');
}

const baseUrl = getBaseUrl(flags);
const ontologyKey = getOntologyKey(flags);

let payload;
try {
  payload = JSON.parse(readFileSync(file, 'utf-8'));
} catch (err) {
  die(`Cannot read ${file}: ${err.message}`);
}

// Reject incomplete transfer payloads before sending them to the server.
// Formats 7.0 and 6.0 carry "keywordLanguages"; the server still imports 5.0,
// which carries one "textSearchLanguage" instead. The server validates the rest.
const hasLanguage = Array.isArray(payload.keywordLanguages) ||
  ['english', 'german'].includes(payload.textSearchLanguage);
if (!Array.isArray(payload.lenses) || !hasLanguage) {
  die(
    `${file} is not an OntoForge transfer payload: expected a "lenses" array and ` +
      '"keywordLanguages" (format 7.0 or 6.0) or a supported "textSearchLanguage" (format 5.0).',
  );
}

try {
  const result = await api(baseUrl, `${modelPath(ontologyKey)}/import`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  const etCount = (payload.entityTypes || []).length;
  const rtCount = (payload.relationTypes || []).length;
  const lenses = result.lenses || [];
  console.error(
    `Imported into ontology ${ontologyKey}: ${etCount} entity types, ` +
      `${rtCount} relation types, ${lenses.length} lenses`,
  );
  for (const lens of lenses) {
    console.error(`  ${lens.key}: ${lens.name}`);
  }
} catch (err) {
  // Import never creates its target. A missing ontology is a registry
  // operation away, so name it instead of echoing a bare 404.
  if (err.message.includes('-> 404')) {
    die(
      `no ontology "${ontologyKey}" on ${baseUrl} — import writes into an ` +
        'existing ontology and never creates one. Create it first: ' +
        `curl -X POST ${baseUrl}/api/ontologies -H 'Content-Type: application/json' ` +
        `-d '{"key":"${ontologyKey}"}'`,
    );
  }
  die(err.message);
}
