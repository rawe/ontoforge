#!/usr/bin/env node
// Import instance data into one ontology from a JSON file, remapping entity
// IDs. The data is written through one lens, so the lens must expose every
// type and property the file carries. It is staged into changesets and
// committed in chunks; entities whose type has an identity, and relations
// of one-per-pair types, are staged as puts, so a rerun updates them.

import { readFileSync } from 'node:fs';
import {
  api,
  changesetWriter,
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

// Which types a rerun can match, as the lens shows them: entity types with
// an identity, relation types that are one per pair.
let lensSchema;
try {
  lensSchema = await api(baseUrl, `${runtimePath(ontologyKey, lensKey)}/schema`);
} catch (err) {
  die(`Cannot read the schema of lens "${lensKey}": ${err.message}`);
}
const withIdentity = new Set(
  (lensSchema.entityTypes || []).filter((type) => (type.identityProperties || []).length > 0).map((type) => type.key),
);
const onePerPair = new Set(
  (lensSchema.relationTypes || []).filter((type) => type.onePerPair || type.parent).map((type) => type.key),
);

const ENTITY_SYSTEM = new Set([
  '_id', '_entityTypeKey', '_createdAt', '_updatedAt', '_identity',
]);
const RELATION_SYSTEM = new Set([
  '_id', '_relationTypeKey', '_createdAt', '_updatedAt',
]);

const prefix = runtimePath(ontologyKey, lensKey);
const writer = changesetWriter(
  (method, path, body) => api(baseUrl, path, { method, body: JSON.stringify(body) }),
  prefix,
  `Data import from ${file}`,
);

try {
  // Phase 1: Stage entities and build old-ID -> new-ID map. A put matches
  // the entity an earlier run wrote by its identity.
  const idMap = new Map();
  let entityCount = 0;
  let updated = 0;

  for (const [typeKey, entities] of Object.entries(data.entities || {})) {
    const operation = withIdentity.has(typeKey) ? 'put_entity' : 'create_entity';
    for (const entity of entities) {
      const oldId = entity._id;
      const properties = {};
      for (const [k, v] of Object.entries(entity)) {
        if (!ENTITY_SYSTEM.has(k)) properties[k] = v;
      }
      await writer.add({ operation, type: typeKey, properties }, (answer) => {
        idMap.set(oldId, answer.id);
        if (answer.action === 'update') updated++;
      });
      entityCount++;
    }
    console.error(`  ${typeKey}: ${entities.length} entities staged`);
  }
  // The relations name the entities by their new ids, staged by now.
  await writer.finish();

  // Phase 2: Stage relations with remapped entity IDs; a put on a
  // one-per-pair type updates the relation an earlier run wrote.
  let relationCount = 0;
  let skipped = 0;

  for (const [typeKey, relations] of Object.entries(data.relations || {})) {
    const operation = onePerPair.has(typeKey) ? 'put_relation' : 'create_relation';
    for (const relation of relations) {
      const fromEntityId = idMap.get(relation.fromEntityId);
      const toEntityId = idMap.get(relation.toEntityId);
      if (!fromEntityId || !toEntityId) {
        skipped++;
        console.error(
          `  Warning: skipping relation (missing entity mapping for ${relation.fromEntityId} -> ${relation.toEntityId})`,
        );
        continue;
      }

      const properties = {};
      for (const [k, v] of Object.entries(relation)) {
        if (!RELATION_SYSTEM.has(k) && k !== 'fromEntityId' && k !== 'toEntityId') {
          properties[k] = v;
        }
      }
      await writer.add({ operation, type: typeKey, fromEntityId, toEntityId, properties }, (answer) => {
        if (answer.action === 'update') updated++;
      });
      relationCount++;
    }
    console.error(`  ${typeKey}: ${relations.length} relations staged`);
  }
  await writer.finish();

  console.error(
    `Done: ${entityCount} entities, ${relationCount} relations imported in ${writer.commits} commits` +
      (updated ? ` (${updated} of them updated what was already there).` : '.'),
  );
  if (skipped) console.error(`  ${skipped} relations skipped (missing entity references).`);
  console.error(
    'Search indices build the imported entities\' search entries in the background; ' +
      'GET /model/search-indices shows their progress.',
  );
} catch (err) {
  const left = writer.changeset ? ` Changeset ${writer.changeset} was left as a draft; nothing in it was committed.` : '';
  die(
    `${err.message}\n${writer.commits} changesets were committed before this.${left} Running the import ` +
      'again updates the entities with an identity and the relations of one-per-pair types it already ' +
      'wrote, and creates everything else again.',
  );
}
