#!/usr/bin/env node
// Import an OntoForge schema from a JSON file into a fresh database.

import { readFileSync } from 'node:fs';
import { api, die, getBaseUrl, parseCliArgs } from './lib.mjs';

const { flags, positional } = parseCliArgs({
  baseUrl: ['--base-url'],
});

const file = positional[0];
if (!file) die('Usage: node import-schema.mjs <file> [--base-url URL]');

const baseUrl = getBaseUrl(flags);

let payload;
try {
  payload = JSON.parse(readFileSync(file, 'utf-8'));
} catch (err) {
  die(`Cannot read ${file}: ${err.message}`);
}

if (!payload.formatVersion) {
  die('Invalid schema file: missing formatVersion field.');
}

try {
  const result = await api(baseUrl, '/api/model/import', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  const etCount = (payload.entityTypes || []).length;
  const rtCount = (payload.relationTypes || []).length;
  const ontologies = result.ontologies || [];
  console.error(
    `Imported ${etCount} entity types, ${rtCount} relation types, ${ontologies.length} ontologies`,
  );
  for (const ont of ontologies) {
    console.error(`  ${ont.key}: ${ont.name}`);
  }
} catch (err) {
  die(err.message);
}
