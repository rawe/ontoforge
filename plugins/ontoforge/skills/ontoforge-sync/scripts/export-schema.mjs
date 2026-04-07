#!/usr/bin/env node
// Export the complete OntoForge global schema to a JSON file.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { api, die, getBaseUrl, parseCliArgs } from './lib.mjs';

const { flags } = parseCliArgs({
  output: ['-o', '--output'],
  baseUrl: ['--base-url'],
});

const baseUrl = getBaseUrl(flags);
const output = flags.output || './ontoforge/schema.json';

try {
  const schema = await api(baseUrl, '/api/model/export');
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(schema, null, 2) + '\n');
  console.log(output);
} catch (err) {
  die(err.message);
}
