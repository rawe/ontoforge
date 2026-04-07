#!/usr/bin/env node
// Export all OntoForge instance data (entities and relations) to a JSON file.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { api, die, getBaseUrl, paginate, parseCliArgs, pickOntologyKey } from './lib.mjs';

const { flags } = parseCliArgs({
  output: ['-o', '--output'],
  baseUrl: ['--base-url'],
  ontologyKey: ['--ontology-key'],
});

const baseUrl = getBaseUrl(flags);
const output = flags.output || './ontoforge/data.json';

try {
  // Get the global schema to discover all type keys
  const schema = await api(baseUrl, '/api/model/export');

  // Resolve ontology key for runtime API access (prefers unscoped)
  const ontologyKey = flags.ontologyKey || pickOntologyKey(schema);
  if (!ontologyKey) die('No ontologies found. Import a schema first.');
  if (!flags.ontologyKey) {
    const isUnscoped = (schema.ontologies || []).some(
      (o) => o.key === ontologyKey && !o.includes,
    );
    console.error(
      `Using ontology: ${ontologyKey}${isUnscoped ? '' : ' (scoped — export may be partial)'}`,
    );
  }

  // Export all entities by type
  const entities = {};
  for (const et of schema.entityTypes || []) {
    try {
      const items = await paginate(
        baseUrl,
        `/api/runtime/${encodeURIComponent(ontologyKey)}/entities/${encodeURIComponent(et.key)}`,
      );
      if (items.length > 0) {
        entities[et.key] = items;
        console.error(`  ${et.key}: ${items.length} entities`);
      }
    } catch (err) {
      if (err.message.includes('404')) continue; // type not in scope
      throw err;
    }
  }

  // Export all relations by type
  const relations = {};
  for (const rt of schema.relationTypes || []) {
    try {
      const items = await paginate(
        baseUrl,
        `/api/runtime/${encodeURIComponent(ontologyKey)}/relations/${encodeURIComponent(rt.key)}`,
      );
      if (items.length > 0) {
        relations[rt.key] = items;
        console.error(`  ${rt.key}: ${items.length} relations`);
      }
    } catch (err) {
      if (err.message.includes('404')) continue; // type not in scope
      throw err;
    }
  }

  const data = {
    formatVersion: '1.0',
    exportedAt: new Date().toISOString(),
    entities,
    relations,
  };

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(data, null, 2) + '\n');
  console.log(output);
} catch (err) {
  die(err.message);
}
