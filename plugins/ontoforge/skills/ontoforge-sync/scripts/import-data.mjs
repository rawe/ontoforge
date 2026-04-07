#!/usr/bin/env node
// Import OntoForge instance data from a JSON file, remapping entity IDs.

import { readFileSync } from 'node:fs';
import { api, die, getBaseUrl, parseCliArgs } from './lib.mjs';

const { flags, positional } = parseCliArgs({
  baseUrl: ['--base-url'],
  ontologyKey: ['--ontology-key'],
});

const file = positional[0];
if (!file) {
  die('Usage: node import-data.mjs <file> [--base-url URL] [--ontology-key KEY]');
}

const baseUrl = getBaseUrl(flags);

let data;
try {
  data = JSON.parse(readFileSync(file, 'utf-8'));
} catch (err) {
  die(`Cannot read ${file}: ${err.message}`);
}

if (!data.formatVersion) {
  die('Invalid data file: missing formatVersion field.');
}

// Resolve ontology key
let ontologyKey = flags.ontologyKey;
if (!ontologyKey) {
  const ontologies = await api(baseUrl, '/api/model/ontologies').catch(() => []);
  if (!ontologies.length) die('No ontologies found. Import a schema first.');
  ontologyKey = ontologies[0].key;
  console.error(`Using ontology: ${ontologyKey}`);
}

const ENTITY_SYSTEM = new Set([
  '_id', '_entityTypeKey', '_createdAt', '_updatedAt',
]);
const RELATION_SYSTEM = new Set([
  '_id', '_relationTypeKey', '_createdAt', '_updatedAt',
]);

const prefix = `/api/runtime/${encodeURIComponent(ontologyKey)}`;

try {
  // Phase 1: Create entities and build old-ID -> new-ID map
  const idMap = new Map();
  let entityCount = 0;

  for (const [typeKey, entities] of Object.entries(data.entities || {})) {
    for (const entity of entities) {
      const oldId = entity._id;
      const props = {};
      for (const [k, v] of Object.entries(entity)) {
        if (!ENTITY_SYSTEM.has(k)) props[k] = v;
      }

      const created = await api(
        baseUrl,
        `${prefix}/entities/${encodeURIComponent(typeKey)}`,
        { method: 'POST', body: JSON.stringify(props) },
      );
      idMap.set(oldId, created._id);
      entityCount++;
    }
    console.error(`  ${typeKey}: ${entities.length} entities created`);
  }

  // Phase 2: Create relations with remapped entity IDs
  let relationCount = 0;
  let skipped = 0;

  for (const [typeKey, relations] of Object.entries(data.relations || {})) {
    for (const relation of relations) {
      const fromId = idMap.get(relation.fromEntityId);
      const toId = idMap.get(relation.toEntityId);
      if (!fromId || !toId) {
        skipped++;
        console.error(
          `  Warning: skipping relation (missing entity mapping for ${relation.fromEntityId} -> ${relation.toEntityId})`,
        );
        continue;
      }

      const props = { fromEntityId: fromId, toEntityId: toId };
      for (const [k, v] of Object.entries(relation)) {
        if (!RELATION_SYSTEM.has(k) && k !== 'fromEntityId' && k !== 'toEntityId') {
          props[k] = v;
        }
      }

      await api(
        baseUrl,
        `${prefix}/relations/${encodeURIComponent(typeKey)}`,
        { method: 'POST', body: JSON.stringify(props) },
      );
      relationCount++;
    }
    console.error(`  ${typeKey}: ${relations.length} relations created`);
  }

  console.error(`Done: ${entityCount} entities, ${relationCount} relations imported.`);
  if (skipped) console.error(`  ${skipped} relations skipped (missing entity references).`);
} catch (err) {
  die(err.message);
}
