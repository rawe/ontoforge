/** Run from the repository root with server/node_modules/.bin/tsx. See USAGE.md. */
import { parseArgs } from "node:util";
import { settings } from "../server/src/config.js";
import { initPool, closePool, runQuery, withTransaction } from "../server/src/adapters/postgres/errors.js";
import { rebuildPropertyKeywords } from "../server/src/maintenance/propertyKeywords.js";
import type { TextSearchLanguage } from "../server/src/registry/schemas.js";

const { values } = parseArgs({ options: { ontology: { type: "string" }, all: { type: "boolean" } } });
if ((values.ontology === undefined) === !values.all) {
  throw new Error("Specify exactly one of --ontology KEY or --all");
}
if (settings.DB_BACKEND !== "postgres") throw new Error("Property keyword maintenance requires PostgreSQL");
await initPool();
try {
  const ontologies = await runQuery(`SELECT key, namespace, text_search_language FROM public.ontology
    WHERE ($1::text IS NULL OR key = $1) ORDER BY key`, [values.ontology ?? null]);
  if (values.ontology && ontologies.rows.length === 0) throw new Error("Ontology not found");
  for (const ontology of ontologies.rows) {
    const result = await withTransaction(
      (tx) => rebuildPropertyKeywords(tx, ontology.text_search_language as TextSearchLanguage),
      "READ COMMITTED",
      ontology.namespace as string,
    );
    console.log(JSON.stringify({ ontology: ontology.key, ...result }));
  }
} finally {
  await closePool();
}
