#!/usr/bin/env node
// Export one ontology's instance data (entities and relations) to a JSON
// file. The data is read through one lens, so the lens decides how much of
// the ontology the export can see.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  api,
  die,
  getBaseUrl,
  getOntologyKey,
  modelPath,
  paginate,
  parseCliArgs,
  pickLensKey,
  runtimePath,
} from './lib.mjs';

const { flags } = parseCliArgs({
  output: ['-o', '--output'],
  baseUrl: ['--base-url'],
  ontology: ['--ontology'],
  lens: ['--lens'],
});

const baseUrl = getBaseUrl(flags);
const ontologyKey = getOntologyKey(flags);
const output = flags.output || './ontoforge/data.json';

try {
  // Read the ontology's design to discover every type key.
  const design = await api(baseUrl, `${modelPath(ontologyKey)}/export`);

  // Resolve the lens the runtime API reads through (prefers unscoped).
  const lensKey = flags.lens || pickLensKey(design);
  if (!lensKey) {
    die(`ontology "${ontologyKey}" has no lens. Create one before exporting data.`);
  }
  if (!flags.lens) {
    const isUnscoped = (design.lenses || []).some(
      (lens) => lens.key === lensKey && !lens.includes,
    );
    console.error(
      `Using lens: ${lensKey}${isUnscoped ? '' : ' (scoped — export may be partial)'}`,
    );
  }

  const prefix = runtimePath(ontologyKey, lensKey);

  // Export all entities by type
  const entities = {};
  for (const et of design.entityTypes || []) {
    // Document properties are returned as stubs by default; request raw
    // values via the fields projection. Since `fields` limits the response,
    // list every property plus the system fields the export format needs.
    let path = `${prefix}/entities/${encodeURIComponent(et.key)}`;
    const props = et.properties || [];
    if (props.some((p) => p.dataType === 'document')) {
      const fields = ['_entityTypeKey', '_createdAt', '_updatedAt', ...props.map((p) => p.key)];
      path += `?${fields.map((f) => `fields=${encodeURIComponent(f)}`).join('&')}`;
    }
    try {
      const items = await paginate(baseUrl, path);
      if (items.length > 0) {
        entities[et.key] = items;
        console.error(`  ${et.key}: ${items.length} entities`);
      }
    } catch (err) {
      if (err.message.includes('404')) continue; // type not visible through the lens
      throw err;
    }
  }

  // Export all relations by type
  const relations = {};
  for (const rt of design.relationTypes || []) {
    try {
      const items = await paginate(
        baseUrl,
        `${prefix}/relations/${encodeURIComponent(rt.key)}`,
      );
      if (items.length > 0) {
        relations[rt.key] = items;
        console.error(`  ${rt.key}: ${items.length} relations`);
      }
    } catch (err) {
      if (err.message.includes('404')) continue; // type not visible through the lens
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
