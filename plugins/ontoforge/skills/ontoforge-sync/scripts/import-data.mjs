#!/usr/bin/env node
// Import instance data into one ontology from a JSON file, remapping entity
// IDs. The data is written through one lens, so the lens must expose every
// type and property the file carries.

import { readFileSync } from 'node:fs';
import {
  api,
  die,
  getBaseUrl,
  getOntologyKey,
  modelPath,
  parseCliArgs,
  pickLensKey,
  runtimePath,
} from './lib.mjs';

const { flags, positional } = parseCliArgs({
  baseUrl: ['--base-url'],
  ontology: ['--ontology'],
  lens: ['--lens'],
});

const file = positional[0];
if (!file) {
  die('Usage: node import-data.mjs <file> [--base-url URL] [--ontology KEY] [--lens KEY]');
}

const baseUrl = getBaseUrl(flags);
const ontologyKey = getOntologyKey(flags);

let data;
try {
  data = JSON.parse(readFileSync(file, 'utf-8'));
} catch (err) {
  die(`Cannot read ${file}: ${err.message}`);
}

if (!data.formatVersion) {
  die('Invalid data file: missing formatVersion field.');
}

// Resolve the lens the runtime API writes through: an unscoped one unless named.
let lensKey = flags.lens;
if (!lensKey) {
  let design;
  try {
    design = await api(baseUrl, `${modelPath(ontologyKey)}/export`);
  } catch (err) {
    die(`Cannot read the design of ontology "${ontologyKey}": ${err.message}`);
  }
  lensKey = pickLensKey(design);
  if (!lensKey) {
    die(
      `ontology "${ontologyKey}" has no unscoped lens. Import the schema first, or pass ` +
        '--lens to write through a scoped lens (it rejects what it hides).',
    );
  }
  console.error(`Using lens: ${lensKey}`);
}

const ENTITY_SYSTEM = new Set([
  '_id', '_entityTypeKey', '_createdAt', '_updatedAt',
]);
const RELATION_SYSTEM = new Set([
  '_id', '_relationTypeKey', '_createdAt', '_updatedAt',
]);

const prefix = runtimePath(ontologyKey, lensKey);

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
  console.error(
    'Search indices build the imported entities\' search entries in the background; ' +
      'GET /model/search-indices shows their progress.',
  );
} catch (err) {
  die(err.message);
}
