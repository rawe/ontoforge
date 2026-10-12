/**
 * `AssistantStore` on PostgreSQL: the assistants of registered kinds,
 * one row each in the `assistant` table of an ontology's namespace.
 */

import type { AssistantKindKey, AssistantRecord, AssistantWrite } from "../../core/assistant.js";
import { ConflictError, NotFoundError } from "../../core/exceptions.js";
import type { AssistantStore, Row } from "../../core/ports.js";
import { runQuery, withTransaction, type DbResult, type Querier } from "./errors.js";
import { isUuid } from "./rows.js";

const COLS = "assistant_id, kind, key, name, description, config_version, config, created_at, updated_at";

function toAssistant(row: Row): AssistantRecord {
  return {
    assistantId: row["assistant_id"] as string,
    kind: row["kind"] as AssistantKindKey,
    key: row["key"] as string,
    name: row["name"] as string,
    description: (row["description"] as string | null) ?? null,
    configVersion: row["config_version"] as number,
    config: row["config"],
    createdAt: row["created_at"] as Date,
    updatedAt: row["updated_at"] as Date,
  };
}

export class PostgresAssistantStore implements AssistantStore {
  constructor(private readonly namespace: string) {}

  private query(text: string, params?: unknown[]): Promise<DbResult> {
    return runQuery(text, params, this.namespace);
  }

  private tx<T>(work: (querier: Querier) => Promise<T>): Promise<T> {
    return withTransaction(work, "READ COMMITTED", this.namespace);
  }

  async listAssistants(lensId: string, kind: AssistantKindKey): Promise<AssistantRecord[]> {
    if (!isUuid(lensId)) return [];
    const result = await this.query(
      `SELECT ${COLS} FROM assistant WHERE lens_id = $1 AND kind = $2 ORDER BY name, key`,
      [lensId, kind],
    );
    return result.rows.map(toAssistant);
  }

  async getAssistant(lensId: string, kind: AssistantKindKey, key: string): Promise<AssistantRecord | null> {
    if (!isUuid(lensId)) return null;
    const result = await this.query(
      `SELECT ${COLS} FROM assistant WHERE lens_id = $1 AND kind = $2 AND key = $3`,
      [lensId, kind, key],
    );
    const row = result.rows[0];
    return row ? toAssistant(row) : null;
  }

  async saveAssistant(
    lensId: string,
    assistant: AssistantWrite,
    createOnly: boolean,
  ): Promise<[AssistantRecord, boolean]> {
    return this.tx(async (querier) => {
      // The lens row lock serializes writes to one lens's assistants.
      if (!isUuid(lensId) || (await querier.query(
        `SELECT lens_id FROM lens WHERE lens_id = $1 FOR UPDATE`, [lensId],
      )).rows.length === 0) {
        throw new NotFoundError("Lens not found");
      }
      const conflict = createOnly
        ? "ON CONFLICT (lens_id, kind, key) DO NOTHING"
        : `ON CONFLICT (lens_id, kind, key) DO UPDATE SET name = EXCLUDED.name,
             description = EXCLUDED.description, config_version = EXCLUDED.config_version,
             config = EXCLUDED.config, updated_at = now()`;
      const result = await querier.query(
        `INSERT INTO assistant (assistant_id, lens_id, kind, key, name, description, config_version, config)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         ${conflict}
         RETURNING ${COLS}, assistant_id = $1 AS created`,
        [
          assistant.assistantId, lensId, assistant.kind, assistant.key, assistant.name,
          assistant.description, assistant.configVersion, JSON.stringify(assistant.config),
        ],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new ConflictError(`Assistant '${assistant.key}' already exists in the target lens`);
      }
      return [toAssistant(row), row["created"] === true];
    });
  }

  async deleteAssistant(lensId: string, kind: AssistantKindKey, key: string): Promise<boolean> {
    if (!isUuid(lensId)) return false;
    const result = await this.query(
      `DELETE FROM assistant WHERE lens_id = $1 AND kind = $2 AND key = $3`,
      [lensId, kind, key],
    );
    return result.rowCount > 0;
  }
}
