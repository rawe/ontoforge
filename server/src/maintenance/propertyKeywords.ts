/** Explicit keyword-only maintenance. Never reads or rewrites embeddings/documents. */
import type { PropertyDef } from "../core/schemas.js";
import { buildKeywordSegments, keywordText } from "../runtime/search/propertyText.js";
import type { TextSearchLanguage } from "../registry/schemas.js";
import type { Querier } from "../adapters/postgres/errors.js";

/** Call inside a transaction bound to one ontology namespace, with writers stopped.
 * Re-running also refreshes keywords after schema changes; untouched rows stay untouched. */
export async function rebuildPropertyKeywords(
  tx: Querier,
  language: TextSearchLanguage,
): Promise<{ scanned: number; updated: number; migrated: boolean }> {
  const config = language === "german" ? "german" : "english";
  await tx.query("LOCK TABLE entity IN ACCESS EXCLUSIVE MODE");
  await tx.query("LOCK TABLE entity_type, property_def IN SHARE MODE");
  await tx.query("ALTER TABLE entity ADD COLUMN IF NOT EXISTS keyword_text text NOT NULL DEFAULT ''");
  await tx.query("ALTER TABLE entity ADD COLUMN IF NOT EXISTS keyword_segments jsonb");
  const schema = await tx.query(`SELECT et.key AS type_key, p.key, p.data_type
    FROM entity_type et JOIN property_def p ON p.entity_type_id = et.entity_type_id
    WHERE p.data_type = 'string' ORDER BY et.key, p.key`);
  const byType = new Map<string, Record<string, PropertyDef>>();
  for (const row of schema.rows) {
    const type = row.type_key as string;
    const defs = byType.get(type) ?? {};
    const key = row.key as string;
    defs[key] = { key, dataType: "string", displayName: key, description: null, required: false, defaultValue: null };
    byType.set(type, defs);
  }
  let scanned = 0;
  let updated = 0;
  let after: string | null = null;
  for (;;) {
    const page = await tx.query(`SELECT id, type_key, props FROM entity
      WHERE ($1::uuid IS NULL OR id > $1::uuid) ORDER BY id LIMIT 200`, [after]);
    if (page.rows.length === 0) break;
    for (const row of page.rows) {
      const segments = buildKeywordSegments(row.props as Record<string, unknown>, byType.get(row.type_key as string) ?? {});
      const result = await tx.query(`UPDATE entity SET keyword_text = $2, keyword_segments = $3::jsonb
        WHERE id = $1 AND (keyword_text IS DISTINCT FROM $2 OR keyword_segments IS DISTINCT FROM $3::jsonb)`,
      [row.id, keywordText(segments), JSON.stringify(segments)]);
      scanned += 1;
      updated += result.rowCount;
      after = row.id as string;
    }
  }
  const expression = await tx.query(`SELECT pg_get_expr(d.adbin, d.adrelid) AS expression
    FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = 'entity'::regclass AND a.attname = 'search_vector'`);
  const migrated = !(String(expression.rows[0]?.expression ?? "").includes("keyword_text"));
  if (migrated) {
    // PostgreSQL removes this column's own GIN index with the column; no CASCADE.
    await tx.query("ALTER TABLE entity DROP COLUMN IF EXISTS search_vector");
    await tx.query(`ALTER TABLE entity ADD COLUMN search_vector tsvector
      GENERATED ALWAYS AS (to_tsvector('${config}'::regconfig, keyword_text)) STORED`);
  }
  await tx.query("CREATE INDEX IF NOT EXISTS entity_keyword_idx ON entity USING gin (search_vector)");
  await tx.query("ANALYZE entity");
  return { scanned, updated, migrated };
}
