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

// `lenses` is the one field the transfer format requires. A pre-4.0 document
// carries them under `ontologies` and is rejected on its shape — there is no
// converter, so say so here rather than letting the server answer 422.
if (!Array.isArray(payload.lenses)) {
  die(
    Array.isArray(payload.ontologies)
      ? `${file} is a pre-4.0 export: its lenses are stored under "ontologies". ` +
          'There is no converter — re-export the design from a current server.'
      : `${file} is not an OntoForge transfer payload: no "lenses" array.`,
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
