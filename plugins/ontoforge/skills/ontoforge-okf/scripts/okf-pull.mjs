#!/usr/bin/env node
// Pull an OntoForge entity as an OKF concept document (Markdown + YAML
// frontmatter). The document property becomes the body, scalar properties
// become frontmatter, and the file is written at <root>/<conceptId>.md.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import {
  api,
  die,
  fetchEntityRaw,
  findEntityIds,
  getBaseUrl,
  parseCliArgs,
  requireOntology,
  resolveBundleContext,
} from './lib.mjs';
import { conceptIdFromPath, fromEntity, pathFromConceptId, resolveDocumentProperty } from './codec.mjs';

const { flags, positional } = parseCliArgs({
  baseUrl: ['--base-url'],
  ontology: ['--ontology'],
  config: ['--config'],
  root: ['--root'],
  type: ['--type'],
  id: ['--id'],
  output: ['-o', '--output'],
});

if (!positional.length && !flags.id) {
  die(
    'usage: okf-pull.mjs <conceptId|file.md> [--type <entityTypeKey>] [--ontology <key>] [--root <dir>] [-o <file>] [--base-url <url>]\n' +
      '       okf-pull.mjs --id <entityId> --type <entityTypeKey> [...]',
  );
}

function typeValueFor(entityTypeKey, config) {
  const reverse = Object.entries(config.typeMap).find(([, v]) => v === entityTypeKey);
  return reverse ? reverse[0] : entityTypeKey;
}

function supportsOkf(entityType, config) {
  const props = entityType.properties || [];
  if (!props.some((p) => p.key === config.conceptIdProperty)) return false;
  try {
    resolveDocumentProperty(entityType, config);
    return true;
  } catch {
    return false;
  }
}

try {
  const { config, root } = resolveBundleContext(process.cwd(), flags);
  const baseUrl = getBaseUrl(flags);
  const ontologyKey = requireOntology(flags, config);

  let entityType;
  let entityId;
  let conceptId = null;

  if (positional.length) {
    const arg = positional[0];
    conceptId = arg.toLowerCase().endsWith('.md')
      ? conceptIdFromPath(
          resolve(arg).startsWith(root) ? resolve(arg).slice(root.length + 1) : arg,
        )
      : arg.replace(/^\/+/, '');
  }

  if (flags.id) {
    if (!flags.type) die('--id requires --type <entityTypeKey>');
    entityType = await api(
      baseUrl,
      `/api/runtime/${encodeURIComponent(ontologyKey)}/schema/entity-types/${encodeURIComponent(flags.type)}`,
    );
    entityId = flags.id;
  } else {
    // Resolve the entity by concept ID, searching the given type or every
    // OKF-capable type in the ontology.
    let candidates;
    if (flags.type) {
      candidates = [
        await api(
          baseUrl,
          `/api/runtime/${encodeURIComponent(ontologyKey)}/schema/entity-types/${encodeURIComponent(flags.type)}`,
        ),
      ];
    } else {
      const all = await api(
        baseUrl,
        `/api/runtime/${encodeURIComponent(ontologyKey)}/schema/entity-types`,
      );
      candidates = all.filter((et) => supportsOkf(et, config));
      if (!candidates.length) {
        die('no entity type in this ontology has both a concept-ID property and a document property');
      }
    }
    const matches = [];
    for (const et of candidates) {
      const ids = await findEntityIds(
        baseUrl, ontologyKey, et.key, config.conceptIdProperty, conceptId,
      );
      for (const id of ids) matches.push({ entityType: et, id });
    }
    if (!matches.length) {
      die(`no entity found with ${config.conceptIdProperty}="${conceptId}"`);
    }
    if (matches.length > 1) {
      const list = matches.map((m) => `${m.entityType.key} (${m.id})`).join(', ');
      die(`concept ID "${conceptId}" is ambiguous: ${list} — pass --type`);
    }
    entityType = matches[0].entityType;
    entityId = matches[0].id;
  }

  const entity = await fetchEntityRaw(baseUrl, ontologyKey, entityType, entityId);
  if (conceptId === null) {
    conceptId = entity[config.conceptIdProperty];
    if (!conceptId) {
      die(`entity ${entityId} has no ${config.conceptIdProperty} value — cannot derive a file path`);
    }
  }

  const mdText = fromEntity(entity, entityType, config, typeValueFor(entityType.key, config));
  const outPath = flags.output ? resolve(flags.output) : join(root, pathFromConceptId(conceptId));
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, mdText);
  console.log(outPath);
} catch (err) {
  die(err.message);
}
