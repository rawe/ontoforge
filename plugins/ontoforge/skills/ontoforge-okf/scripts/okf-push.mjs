#!/usr/bin/env node
// Push OKF concept documents (Markdown + YAML frontmatter) into OntoForge
// entities. The frontmatter becomes scalar properties, the body becomes the
// document property, and the file path (relative to the bundle root) becomes
// the concept ID — the identity of the document. Idempotent: an existing
// entity is updated, a missing one created.

import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

import {
  api,
  die,
  findByConceptId,
  getBaseUrl,
  loadMappedTypes,
  parseCliArgs,
  resolveBundleContext,
} from './lib.mjs';
import { conceptIdFromPath, entityTypeKeyFor, parseConceptDocument, toEntityPayload } from './codec.mjs';

const USAGE = 'usage: okf-push.mjs <file.md> [<file.md> ...] [--skip-unknown]';

try {
  const { flags, positional } = parseCliArgs({ skipUnknown: ['--skip-unknown'] });
  if (!positional.length) die(USAGE);

  const files = positional.map((file) => resolve(file));
  const { config, root, configPath } = resolveBundleContext(dirname(files[0]));
  const baseUrl = getBaseUrl();
  const ontologyKey = config.ontology;
  const mappedTypes = await loadMappedTypes(baseUrl, ontologyKey, config, configPath);
  const basePathFor = (entityTypeKey) =>
    `/api/runtime/${encodeURIComponent(ontologyKey)}/entities/${encodeURIComponent(entityTypeKey)}`;

  let failures = 0;
  for (const abs of files) {
    try {
      const conceptId = conceptIdFromPath(relative(root, abs));
      const doc = parseConceptDocument(readFileSync(abs, 'utf8'));

      const typeValue = doc.fields.type;
      if (typeof typeValue !== 'string' || !typeValue) {
        throw new Error('frontmatter has no "type" field (required by OKF)');
      }
      const entityTypeKey = entityTypeKeyFor(typeValue, config, configPath);
      const entityType = mappedTypes.get(entityTypeKey);

      const { payload, unknownKeys } = toEntityPayload(doc, conceptId, entityType, config);
      if (unknownKeys.length) {
        const message = `frontmatter keys with no property on "${entityTypeKey}": ${unknownKeys.join(', ')}`;
        if (!flags.skipUnknown) {
          throw new Error(`${message} — add the properties or pass --skip-unknown`);
        }
        console.error(`  warning: skipping ${message}`);
      }

      // The concept ID alone identifies the document, so a match under a
      // different entity type is a conflict, not a second concept.
      const matches = await findByConceptId(baseUrl, ontologyKey, config, mappedTypes, conceptId);
      if (matches.length > 1) {
        const list = matches.map((m) => `${m.entityTypeKey} (${m.id})`).join(', ');
        throw new Error(`concept ID "${conceptId}" already exists more than once: ${list} — resolve the duplicates first`);
      }
      if (matches.length === 1 && matches[0].entityTypeKey !== entityTypeKey) {
        throw new Error(
          `concept ID "${conceptId}" is stored as "${matches[0].entityTypeKey}" but this document declares "${entityTypeKey}" — ` +
            'an entity cannot change type; delete the stored entity first',
        );
      }

      if (matches.length === 0) {
        const created = await api(baseUrl, basePathFor(entityTypeKey), {
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
        await api(baseUrl, `${basePathFor(entityTypeKey)}/${encodeURIComponent(matches[0].id)}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        console.log(`updated  ${entityTypeKey}/${conceptId} (${matches[0].id})`);
      }
    } catch (err) {
      failures += 1;
      console.error(`failed   ${abs}: ${err.message}`);
    }
  }
  if (failures) die(`${failures} of ${files.length} file(s) failed`);
} catch (err) {
  die(err.message);
}
