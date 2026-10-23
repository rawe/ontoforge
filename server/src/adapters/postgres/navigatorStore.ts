/**
 * `NavigatorStore` on PostgreSQL: one row per navigator in the
 * `assistant_navigator` table of an ontology's namespace. Handed out by a
 * design change (`ModelingStore.changeDesign`), it runs on that change's
 * connection.
 */

import type { NavigatorRecord, NavigatorWrite } from "../../core/navigator.js";
import { ConflictError, NotFoundError } from "../../core/exceptions.js";
import type { NavigatorStore, Row } from "../../core/ports.js";
import { runQuery, withTransaction, type DbResult, type Querier } from "./errors.js";
import { isUuid } from "./rows.js";

const COLS = "assistant_navigator_id, key, name, description, config_version, config, created_at, updated_at";

function toNavigator(row: Row): NavigatorRecord {
  return {
    navigatorId: row["assistant_navigator_id"] as string,
    key: row["key"] as string,
    name: row["name"] as string,
    description: (row["description"] as string | null) ?? null,
    configVersion: row["config_version"] as number,
    config: row["config"],
    createdAt: row["created_at"] as Date,
    updatedAt: row["updated_at"] as Date,
  };
}

export class PostgresNavigatorStore implements NavigatorStore {
  /** `bound`: the connection of the design change it belongs to. */
  constructor(
    private readonly namespace: string,
    private readonly bound?: Querier,
  ) {}

  private query(text: string, params?: unknown[]): Promise<DbResult> {
    if (this.bound !== undefined) return this.bound.query(text, params);
    return runQuery(text, params, this.namespace);
  }

  private tx<T>(work: (querier: Querier) => Promise<T>): Promise<T> {
    if (this.bound !== undefined) return work(this.bound);
    return withTransaction(work, "READ COMMITTED", this.namespace);
  }

  async listNavigators(lensId: string): Promise<NavigatorRecord[]> {
    if (!isUuid(lensId)) return [];
    const result = await this.query(
      `SELECT ${COLS} FROM assistant_navigator WHERE lens_id = $1 ORDER BY name, key`,
      [lensId],
    );
    return result.rows.map(toNavigator);
  }

  async getNavigator(lensId: string, key: string): Promise<NavigatorRecord | null> {
    if (!isUuid(lensId)) return null;
    const result = await this.query(
      `SELECT ${COLS} FROM assistant_navigator WHERE lens_id = $1 AND key = $2`,
      [lensId, key],
    );
    const row = result.rows[0];
    return row ? toNavigator(row) : null;
  }

  async saveNavigator(
    lensId: string,
    navigator: NavigatorWrite,
    createOnly: boolean,
  ): Promise<[NavigatorRecord, boolean]> {
    return this.tx(async (querier) => {
      // The lens row lock serializes writes to one lens's navigators.
      if (!isUuid(lensId) || (await querier.query(
        `SELECT lens_id FROM lens WHERE lens_id = $1 FOR UPDATE`, [lensId],
      )).rows.length === 0) {
        throw new NotFoundError("Lens not found");
      }
      const conflict = createOnly
        ? "ON CONFLICT (lens_id, key) DO NOTHING"
        : `ON CONFLICT (lens_id, key) DO UPDATE SET name = EXCLUDED.name,
             description = EXCLUDED.description, config_version = EXCLUDED.config_version,
             config = EXCLUDED.config, updated_at = now()`;
      const result = await querier.query(
        `INSERT INTO assistant_navigator
           (assistant_navigator_id, lens_id, key, name, description, config_version, config)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         ${conflict}
         RETURNING ${COLS}, assistant_navigator_id = $1 AS created`,
        [
          navigator.navigatorId, lensId, navigator.key, navigator.name,
          navigator.description, navigator.configVersion, JSON.stringify(navigator.config),
        ],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new ConflictError(`Navigator '${navigator.key}' already exists in the target lens`);
      }
      return [toNavigator(row), row["created"] === true];
    });
  }

  async deleteNavigator(lensId: string, key: string): Promise<boolean> {
    if (!isUuid(lensId)) return false;
    const result = await this.query(
      `DELETE FROM assistant_navigator WHERE lens_id = $1 AND key = $2`,
      [lensId, key],
    );
    return result.rowCount > 0;
  }
}
