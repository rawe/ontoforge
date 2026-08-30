#!/usr/bin/env node
// Export one ontology's design (schema, lenses, agents, saved queries) to a
// JSON file. Instance data is not part of the transfer format — use
// export-data.mjs for that.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { api, die, getBaseUrl, getOntologyKey, modelPath, parseCliArgs } from './lib.mjs';

const { flags } = parseCliArgs({
  output: ['-o', '--output'],
  baseUrl: ['--base-url'],
  ontology: ['--ontology'],
});

const baseUrl = getBaseUrl(flags);
const ontologyKey = getOntologyKey(flags);
const output = flags.output || './ontoforge/schema.json';

try {
  const design = await api(baseUrl, `${modelPath(ontologyKey)}/export`);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(design, null, 2) + '\n');
  console.log(output);
} catch (err) {
  die(err.message);
}
