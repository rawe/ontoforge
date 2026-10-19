/**
 * `AnchorStore` on PostgreSQL: one row per anchor in the `anchor` table of
 * an ontology's namespace. Every read joins `entity` on id and type, so
 * the record says whether its entity is still stored.
 */

import type { AnchorEntity, AnchorRecord, AnchorStore, Row } from "../../core/ports.js";
import { runQuery, type DbResult, type Querier } from "./errors.js";

/** The anchor columns of `a` and whether the join found its entity. */
const JOINED = `a.key, a.entity_type_key, a.entity_id, a.staged_only, e.id IS NOT NULL AS entity_found`;
const JOIN = `LEFT JOIN entity e ON e.id = a.entity_id AND e.type_key = a.entity_type_key`;

function toAnchor(row: Row): AnchorRecord {
  const type = row["entity_type_key"] as string | null;
  const id = row["entity_id"] as string | null;
  return {
    key: row["key"] as string,
    entity: type === null || id === null ? null : { type, id },
    entityFound: row["entity_found"] === true,
    stagedOnly: row["staged_only"] === true,
  };
}

export class PostgresAnchorStore implements AnchorStore {
  /** `bound`: the connection of the runtime store's transaction. */
  constructor(
    private readonly namespace: string,
    private readonly bound?: Querier,
  ) {}

  private query(text: string, params?: unknown[]): Promise<DbResult> {
    if (this.bound !== undefined) {
      return this.bound.query(text, params);
    }
    return runQuery(text, params, this.namespace);
  }

  async listAnchors(): Promise<AnchorRecord[]> {
    const result = await this.query(`SELECT ${JOINED} FROM anchor a ${JOIN} ORDER BY a.key`);
    return result.rows.map(toAnchor);
  }

  async getAnchor(key: string): Promise<AnchorRecord | null> {
    const result = await this.query(`SELECT ${JOINED} FROM anchor a ${JOIN} WHERE a.key = $1`, [key]);
    const row = result.rows[0];
    return row ? toAnchor(row) : null;
  }

  async saveAnchor(key: string, entity: AnchorEntity | null, stagedOnly?: boolean): Promise<AnchorRecord> {
    // $4 null: a new anchor is not staged-only, an existing one keeps its flag.
    const result = await this.query(
      `WITH a AS (
         INSERT INTO anchor (key, entity_type_key, entity_id, staged_only)
         VALUES ($1, $2, $3, COALESCE($4::boolean, false))
         ON CONFLICT (key) DO UPDATE SET entity_type_key = EXCLUDED.entity_type_key,
           entity_id = EXCLUDED.entity_id,
           staged_only = COALESCE($4::boolean, anchor.staged_only), updated_at = now()
         RETURNING key, entity_type_key, entity_id, staged_only
       )
       SELECT ${JOINED} FROM a ${JOIN}`,
      [key, entity?.type ?? null, entity?.id ?? null, stagedOnly ?? null],
    );
    return toAnchor(result.rows[0]!);
  }

  async deleteAnchor(key: string): Promise<boolean> {
    const result = await this.query(`DELETE FROM anchor WHERE key = $1`, [key]);
    return result.rowCount > 0;
  }
}
