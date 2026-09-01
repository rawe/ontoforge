#!/usr/bin/env node
// Pull an OntoForge entity as an OKF concept document (Markdown + YAML
// frontmatter). The document property becomes the body and scalar properties
// become frontmatter. The target file path is the argument, exactly as in
// push, and the concept ID is derived from it.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

import {
  die,
  fetchEntityRaw,
  findByConceptId,
  getBaseUrl,
  loadMappedTypes,
  parseCliArgs,
  resolveBundleContext,
} from './lib.mjs';
import { conceptIdFromPath, fromEntity, typeValueFor } from './codec.mjs';

const USAGE = 'usage: okf-pull.mjs <file.md>';

try {
  const { positional } = parseCliArgs();
  if (positional.length !== 1) die(USAGE);

  const abs = resolve(positional[0]);
  const { config, root, configPath } = resolveBundleContext(dirname(abs));
  const conceptId = conceptIdFromPath(relative(root, abs));

  const baseUrl = getBaseUrl();
  const mappedTypes = await loadMappedTypes(baseUrl, config, configPath);

  const matches = await findByConceptId(baseUrl, config, mappedTypes, conceptId);
  if (!matches.length) {
    die(`no entity found with ${config.conceptIdProperty}="${conceptId}"`);
  }
  if (matches.length > 1) {
    const list = matches.map((m) => `${m.entityTypeKey} (${m.id})`).join(', ');
    die(`concept ID "${conceptId}" exists more than once: ${list} — resolve the duplicates first`);
  }

  const entityType = mappedTypes.get(matches[0].entityTypeKey);
  const entity = await fetchEntityRaw(baseUrl, config, entityType, matches[0].id);
  const mdText = fromEntity(entity, entityType, config, typeValueFor(entityType.key, config));

  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, mdText);
  console.log(abs);
} catch (err) {
  die(err.message);
}
