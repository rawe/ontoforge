/**
 * `OntologyRegistry` on PostgreSQL: one PG namespace per ontology.
 *
 * The registry lives in `public.ontology` — the server-wide home — and
 * is the authoritative ontology list; the PG catalog is never consulted
 * for it. Each ontology's physical home is the namespace `ont_<key>`
 * (the 59-char ontology key cap keeps that within PG's 63-char
 * identifier limit; the key is immutable, so a namespace never renames).
 *
 * Create is one transaction: the registry row first — so a concurrent
 * same-key create dies on `ontology_key_unique` and translates to the
 * conflict the service pre-check would have raised — then
 * `CREATE SCHEMA`, the ten-table DDL and the fixed vector indexes inside
 * the fresh namespace via `SET LOCAL search_path` (`public` stays on the
 * path for the pgvector type; the new namespace comes first, so every
 * unqualified name lands there). A failure anywhere rolls the whole
 * provision back — no namespace, no row.
 *
 * Delete is the mirror: the registry row goes (its absence is
 * not-found), then the row's stored namespace drops in one
 * `DROP SCHEMA … CASCADE`.
 */

import type { OntologyRegistry, Row } from "../../core/ports.js";
import { fixedVectorIndexStatements, ONTOLOGY_DDL_STATEMENTS } from "./ddl.js";
import { runQuery, withTransaction } from "./errors.js";
import { quoteIdent } from "./oql/bindings.js";
import { camelizeRow, camelizeRows } from "./rows.js";

// The port-visible shape; the physical `namespace` column stays inside
// the adapter.
const ONTOLOGY_COLS = "ontology_id, key, display_name, created_at, updated_at";

/** The namespace an ontology key names — the binding the bound stores
 * carry (`index.ts`). */
export function ontologyNamespace(key: string): string {
  return `ont_${key}`;
}

/** One registered ontology as the adapter's maintenance sees it: the
 * namespace it works in, and the key it names the ontology by when it
 * has something to report. */
export interface OntologyBinding {
  key: string;
  namespace: string;
}

/** Every registered ontology, in key order — what the adapter's
 * per-namespace maintenance walks (`index.ts`). The registry, not the PG
 * catalog, is the authoritative list. */
export async function listOntologyBindings(): Promise<OntologyBinding[]> {
  const result = await runQuery(`SELECT key, namespace FROM public.ontology ORDER BY key`);
  return result.rows.map((row) => ({
    key: row["key"] as string,
    namespace: row["namespace"] as string,
  }));
}

export class PostgresOntologyRegistry implements OntologyRegistry {
  async createOntology(
    ontologyId: string,
    key: string,
    displayName: string | null,
    embeddingDimensions: number | null,
  ): Promise<Row> {
    const namespace = ontologyNamespace(key);
    return withTransaction(async (querier) => {
      const result = await querier.query(
        `INSERT INTO public.ontology (ontology_id, key, display_name, namespace)
         VALUES ($1, $2, $3, $4)
         RETURNING ${ONTOLOGY_COLS}`,
        [ontologyId, key, displayName, namespace],
      );
      await querier.query(`CREATE SCHEMA ${quoteIdent(namespace)}`);
      await querier.query(`SET LOCAL search_path TO ${quoteIdent(namespace)}, public`);
      for (const statement of ONTOLOGY_DDL_STATEMENTS) {
        await querier.query(statement);
      }
      if (embeddingDimensions !== null) {
        for (const statement of fixedVectorIndexStatements(embeddingDimensions)) {
          await querier.query(statement);
        }
      }
      return camelizeRow(result.rows[0]!);
    });
  }

  async listOntologies(): Promise<Row[]> {
    const result = await runQuery(
      `SELECT ${ONTOLOGY_COLS} FROM public.ontology ORDER BY key`,
    );
    return camelizeRows(result.rows);
  }

  async getOntology(key: string): Promise<Row | null> {
    const result = await runQuery(
      `SELECT ${ONTOLOGY_COLS} FROM public.ontology WHERE key = $1`,
      [key],
    );
    const row = result.rows[0];
    return row ? camelizeRow(row) : null;
  }

  async getOntologyByDisplayName(displayName: string): Promise<Row | null> {
    const result = await runQuery(
      `SELECT ${ONTOLOGY_COLS} FROM public.ontology WHERE display_name = $1`,
      [displayName],
    );
    const row = result.rows[0];
    return row ? camelizeRow(row) : null;
  }

  async renameOntology(key: string, displayName: string): Promise<Row | null> {
    const result = await runQuery(
      `UPDATE public.ontology SET display_name = $2, updated_at = now()
       WHERE key = $1
       RETURNING ${ONTOLOGY_COLS}`,
      [key, displayName],
    );
    const row = result.rows[0];
    return row ? camelizeRow(row) : null;
  }

  async deleteOntology(key: string): Promise<boolean> {
    return withTransaction(async (querier) => {
      const result = await querier.query(
        `DELETE FROM public.ontology WHERE key = $1 RETURNING namespace`,
        [key],
      );
      const row = result.rows[0];
      if (row === undefined) {
        return false;
      }
      // IF EXISTS: the registry row is authoritative — a namespace already
      // gone must not block deleting the ontology it belonged to.
      await querier.query(
        `DROP SCHEMA IF EXISTS ${quoteIdent(row["namespace"] as string)} CASCADE`,
      );
      return true;
    });
  }
}
