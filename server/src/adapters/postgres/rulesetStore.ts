/**
 * `RulesetStore` on PostgreSQL: one row per ruleset in the `ruleset` table
 * of an ontology's namespace. Every read joins `entity` on the anchor's id
 * and type, so the record says whether the anchor's entity is still stored.
 */

import type { Row, RulesetPatch, RulesetRecord, RulesetStore, WriteAccess } from "../../core/ports.js";
import { runQuery, type DbResult, type Querier } from "./errors.js";

/** The ruleset columns of `r` and whether the join found its anchor. */
const JOINED = `r.key, r.anchor_type_key, r.anchor_id, r.write_access, e.id IS NOT NULL AS anchor_found`;
const JOIN = `LEFT JOIN entity e ON e.id = r.anchor_id AND e.type_key = r.anchor_type_key`;

function toRuleset(row: Row): RulesetRecord {
  const type = row["anchor_type_key"] as string | null;
  const id = row["anchor_id"] as string | null;
  return {
    key: row["key"] as string,
    anchor: type === null || id === null ? null : { type, id },
    anchorFound: row["anchor_found"] === true,
    writeAccess: row["write_access"] as WriteAccess,
  };
}

export class PostgresRulesetStore implements RulesetStore {
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

  async list(): Promise<RulesetRecord[]> {
    const result = await this.query(`SELECT ${JOINED} FROM ruleset r ${JOIN} ORDER BY r.key`);
    return result.rows.map(toRuleset);
  }

  async get(key: string): Promise<RulesetRecord | null> {
    const result = await this.query(`SELECT ${JOINED} FROM ruleset r ${JOIN} WHERE r.key = $1`, [key]);
    const row = result.rows[0];
    return row ? toRuleset(row) : null;
  }

  async save(key: string, patch: RulesetPatch): Promise<RulesetRecord> {
    // $2 says whether the patch names the anchor, since its null removes
    // it; a null $5 keeps the stored write access, and a new ruleset's is
    // 'full', the column default.
    const result = await this.query(
      `WITH r AS (
         INSERT INTO ruleset (key, anchor_type_key, anchor_id, write_access)
         VALUES ($1, $3, $4, COALESCE($5::text, 'full'))
         ON CONFLICT (key) DO UPDATE SET
           anchor_type_key = CASE WHEN $2::boolean THEN EXCLUDED.anchor_type_key ELSE ruleset.anchor_type_key END,
           anchor_id = CASE WHEN $2::boolean THEN EXCLUDED.anchor_id ELSE ruleset.anchor_id END,
           write_access = COALESCE($5::text, ruleset.write_access), updated_at = now()
         RETURNING key, anchor_type_key, anchor_id, write_access
       )
       SELECT ${JOINED} FROM r ${JOIN}`,
      [key, patch.anchor !== undefined, patch.anchor?.type ?? null, patch.anchor?.id ?? null, patch.writeAccess ?? null],
    );
    return toRuleset(result.rows[0]!);
  }

  async delete(key: string): Promise<boolean> {
    const result = await this.query(`DELETE FROM ruleset WHERE key = $1`, [key]);
    return result.rowCount > 0;
  }
}
