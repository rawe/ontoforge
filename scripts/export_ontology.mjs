#!/usr/bin/env node
// Export an OntoForge ontology to structured JSON files via the Runtime REST API.
// Requires Node >= 18 (global fetch). No dependencies.

import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import process from "node:process";

// Property names checked in order to find a human-readable slug for filenames.
// First match (present in schema AND non-empty on the entity) wins.
// Fallback: the entity's _id (UUID).
const SLUG_CANDIDATES = ["key", "name", "title", "label", "display_name", "displayName"];

// System/metadata fields stripped from exported entity and relation data.
const SYSTEM_FIELDS = new Set(["_id", "_entityTypeKey", "_relationTypeKey", "_createdAt", "_updatedAt"]);

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function getJson(url, params = {}) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  let resp;
  try {
    resp = await fetch(u);
  } catch {
    console.error(`Error: cannot connect to ${u.origin}`);
    process.exit(1);
  }
  if (!resp.ok) {
    console.error(`Error: API returned ${resp.status}: ${await resp.text()}`);
    process.exit(1);
  }
  return resp.json();
}

/** Paginate through all items from a list endpoint (max page size 200). */
async function listAll(url, params = {}) {
  const limit = params.limit ?? 200;
  let offset = 0;
  const allItems = [];
  for (;;) {
    const data = await getJson(url, { ...params, limit, offset });
    allItems.push(...data.items);
    if (allItems.length >= data.total) break;
    offset += limit;
  }
  return allItems;
}

// ---------------------------------------------------------------------------
// Naming helpers
// ---------------------------------------------------------------------------

/** Slugify a string for use as a filename: lowercase ASCII, hyphen-separated, max 80 chars. */
function slugify(value, maxLength = 80) {
  const slug = value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "") // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, maxLength).replace(/-+$/, "");
}

/** Determine which property to use for filenames based on SLUG_CANDIDATES order. */
function findSlugProperty(entityType) {
  const propKeys = new Set(entityType.properties.map((p) => p.key));
  return SLUG_CANDIDATES.find((c) => propKeys.has(c)) ?? null;
}

/** Generate a unique slugified filename (without extension) for an entity. */
function makeFilename(entity, slugProp, seen) {
  let base = null;
  if (slugProp && entity[slugProp]) base = slugify(String(entity[slugProp]));
  if (!base) base = entity._id;

  let filename = base;
  let counter = 2;
  while (seen.has(filename)) {
    filename = `${base}-${counter}`;
    counter += 1;
  }
  seen.add(filename);
  return filename;
}

function stripSystemFields(data) {
  return Object.fromEntries(Object.entries(data).filter(([k]) => !SYSTEM_FIELDS.has(k)));
}

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

// ---------------------------------------------------------------------------
// Export logic
// ---------------------------------------------------------------------------

async function exportOntology(baseUrl, ontologyKey, outputDir) {
  const apiBase = `${baseUrl.replace(/\/+$/, "")}/api/runtime/${ontologyKey}`;
  const exportDir = join(outputDir, `data_${ontologyKey}_${timestamp()}`);

  // ── Schema ─────────────────────────────────────────────────────
  console.log(`Fetching schema from ${apiBase}/schema ...`);
  const schema = await getJson(`${apiBase}/schema`);

  const ontologyName = schema.ontology.name ?? ontologyKey;
  const entityTypes = schema.entityTypes;
  const relationTypes = schema.relationTypes;

  console.log(`Ontology: ${ontologyName}`);
  console.log(`Entity types: ${entityTypes.map((et) => et.key).join(", ")}`);
  console.log(`Relation types: ${relationTypes.map((rt) => rt.key).join(", ")}`);

  // ── Export schema ──────────────────────────────────────────
  mkdirSync(exportDir, { recursive: true });
  const schemaFile = `${ontologyKey}_schema.json`;
  writeJson(join(exportDir, schemaFile), schema);
  console.log(`\nSchema exported: ${schemaFile}`);

  // Determine slug property per entity type
  const slugProps = {};
  for (const et of entityTypes) {
    slugProps[et.key] = findSlugProperty(et);
    console.log(`  ${et.key}: filename from '${slugProps[et.key] ?? "_id (fallback)"}'`);
  }

  // ── Phase 1: Export entities ───────────────────────────────────
  // Maps entity UUID → {type: entityTypeKey, file: filenameWithoutExt}
  const idToFile = {};

  for (const et of entityTypes) {
    const etDir = join(exportDir, et.key);
    mkdirSync(etDir, { recursive: true });

    const entities = await listAll(`${apiBase}/entities/${et.key}`);
    console.log(`\nExporting ${entities.length} ${et.key} entities ...`);

    const seen = new Set();
    for (const entity of entities) {
      const filename = makeFilename(entity, slugProps[et.key], seen);
      idToFile[entity._id] = { type: et.key, file: filename };

      writeJson(join(etDir, `${filename}.json`), stripSystemFields(entity));
      console.log(`  ${filename}.json`);
    }
  }

  // ── Phase 2: Export relations ──────────────────────────────────
  const relationsDir = join(exportDir, "relations");
  mkdirSync(relationsDir, { recursive: true });

  for (const rt of relationTypes) {
    const relations = await listAll(`${apiBase}/relations/${rt.key}`);

    if (relations.length === 0) {
      console.log(`\nSkipping ${rt.key} (0 relations)`);
      continue;
    }

    console.log(`\nExporting ${relations.length} ${rt.key} relations ...`);

    const exported = [];
    for (const rel of relations) {
      const fromRef = idToFile[rel.fromEntityId];
      const toRef = idToFile[rel.toEntityId];

      if (!fromRef || !toRef) {
        console.log(`  WARNING: unresolved reference in relation ${rel._id}, skipping`);
        continue;
      }

      const entry = {
        from: { type: fromRef.type, file: fromRef.file },
        to: { type: toRef.type, file: toRef.file },
      };

      // Include any custom properties defined on the relation
      const custom = Object.fromEntries(
        Object.entries(rel).filter(
          ([k]) => !SYSTEM_FIELDS.has(k) && k !== "fromEntityId" && k !== "toEntityId"
        )
      );
      if (Object.keys(custom).length > 0) entry.properties = custom;

      exported.push(entry);
    }

    writeJson(join(relationsDir, `${rt.key}.json`), exported);
    console.log(`  ${rt.key}.json (${exported.length} entries)`);
  }

  console.log(`\nExport complete: ${exportDir}`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const { values, positionals } = parseArgs({
    options: {
      output: { type: "string", short: "o" },
      "base-url": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help || positionals.length !== 1 || !values.output) {
    console.error(
      "Usage: node export_ontology.mjs <ontology_key> -o <output_dir> [--base-url <url>]\n\n" +
        "Export an OntoForge ontology to structured JSON files.\n\n" +
        "  <ontology_key>   Ontology key (e.g. wacker_pi_planning)\n" +
        "  -o, --output     Parent directory for the export (must exist).\n" +
        "                   A timestamped subfolder is created inside.\n" +
        "  --base-url       OntoForge server base URL\n" +
        "                   (default: $ONTOFORGE_BASE_URL or http://localhost:8000)"
    );
    process.exit(values.help ? 0 : 1);
  }

  const baseUrl = values["base-url"] ?? process.env.ONTOFORGE_BASE_URL ?? "http://localhost:8000";

  if (!existsSync(values.output)) {
    console.error(`Error: output directory does not exist: ${values.output}`);
    process.exit(1);
  }

  return exportOntology(baseUrl, positionals[0], values.output);
}

await main();
