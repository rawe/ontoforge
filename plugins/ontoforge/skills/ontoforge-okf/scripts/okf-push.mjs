#!/usr/bin/env node
// Push OKF concept documents (Markdown + YAML frontmatter) into OntoForge
// entities. The frontmatter becomes scalar properties, the body becomes the
// document property, and the file path (relative to the bundle root) becomes
// the concept ID used as the natural key. Idempotent: existing entities are
// updated, missing ones created.

import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

import {
  api,
  die,
  findEntityIds,
  getBaseUrl,
  parseCliArgs,
  requireOntology,
  resolveBundleContext,
} from './lib.mjs';
import { conceptIdFromPath, parseConceptDocument, toEntityPayload } from './codec.mjs';

const { flags, positional } = parseCliArgs(
  {
    baseUrl: ['--base-url'],
    ontology: ['--ontology'],
    config: ['--config'],
    root: ['--root'],
    type: ['--type'],
  },
  { skipUnknown: ['--skip-unknown'] },
);

if (!positional.length) {
  die(
    'usage: okf-push.mjs <file.md> [<file.md> ...] [--ontology <key>] [--root <dir>] [--config <okf.config.json>] [--type <entityTypeKey>] [--skip-unknown] [--base-url <url>]',
  );
}

const typeCache = new Map();

async function getEntityType(baseUrl, ontologyKey, typeKey) {
  if (!typeCache.has(typeKey)) {
    const path = `/api/runtime/${encodeURIComponent(ontologyKey)}/schema/entity-types/${encodeURIComponent(typeKey)}`;
    typeCache.set(typeKey, await api(baseUrl, path));
  }
  return typeCache.get(typeKey);
}

try {
  let failures = 0;
  for (const file of positional) {
    const abs = resolve(file);
    const { config, root } = resolveBundleContext(dirname(abs), flags);
    const baseUrl = getBaseUrl(flags);
    const ontologyKey = requireOntology(flags, config);

    try {
      const conceptId = conceptIdFromPath(relative(root, abs));
      const doc = parseConceptDocument(readFileSync(abs, 'utf8'));

      const typeValue = doc.fields.type;
      if (typeof typeValue !== 'string' || !typeValue) {
        throw new Error('frontmatter has no "type" field (required by OKF)');
      }
      const entityTypeKey = flags.type || config.typeMap[typeValue] || typeValue;
      const entityType = await getEntityType(baseUrl, ontologyKey, entityTypeKey);

      const { payload, unknownKeys } = toEntityPayload(doc, conceptId, entityType, config);
      if (unknownKeys.length) {
        const message = `frontmatter keys with no property on "${entityTypeKey}": ${unknownKeys.join(', ')}`;
        if (!flags.skipUnknown) {
          throw new Error(`${message} — add the properties or pass --skip-unknown`);
        }
        console.error(`  warning: skipping ${message}`);
      }

      const ids = await findEntityIds(
        baseUrl, ontologyKey, entityTypeKey, config.conceptIdProperty, conceptId,
      );
      if (ids.length > 1) {
        throw new Error(
          `more than one "${entityTypeKey}" entity has ${config.conceptIdProperty}="${conceptId}" — resolve the duplicates first`,
        );
      }

      const basePath = `/api/runtime/${encodeURIComponent(ontologyKey)}/entities/${encodeURIComponent(entityTypeKey)}`;
      if (ids.length === 0) {
        const created = await api(baseUrl, basePath, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        console.log(`created  ${entityTypeKey}/${conceptId} (${created._id})`);
      } else {
        // The file is the full representation of the concept: properties
        // absent from the frontmatter are cleared (PATCH null removes).
        for (const def of entityType.properties || []) {
          if (def.dataType === 'document' && !(def.key in payload)) continue;
          if (!(def.key in payload)) payload[def.key] = null;
        }
        await api(baseUrl, `${basePath}/${encodeURIComponent(ids[0])}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        console.log(`updated  ${entityTypeKey}/${conceptId} (${ids[0]})`);
      }
    } catch (err) {
      failures += 1;
      console.error(`failed   ${file}: ${err.message}`);
    }
  }
  if (failures) die(`${failures} of ${positional.length} file(s) failed`);
} catch (err) {
  die(err.message);
}
