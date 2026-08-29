/**
 * Shared full-schema assembly for the PostgreSQL adapter.
 *
 * Both stores' `getFullSchema` — modeling's global schema and the
 * runtime lens view — read the same type, property and inclusion tables,
 * so the type SELECTs, the props-bucketing, and the inclusion
 * classification live here once. Callers pass the `Querier` of their own
 * open REPEATABLE READ transaction and keep their lens and inclusion
 * SELECTs, which differ (all lenses vs. one by key).
 */

import type { Row } from "../../core/ports.js";
import type { Querier } from "./errors.js";
import { camelizeRow } from "./rows.js";

/** Lens read columns — the port-visible shape of a lens row. */
export const LENS_COLS = "lens_id, key, name, description, created_at, updated_at";

const PROPERTY_COLS =
  "property_id, key, display_name, description, data_type, required, default_value";

/**
 * Every entity type and relation type with its property rows attached,
 * all ordered by key. Modeling's global schema keeps timestamps on
 * property rows; the runtime lens view carries them without — the flag
 * preserves each caller's shape.
 */
export async function readTypesWithProperties(
  querier: Querier,
  includePropertyTimestamps: boolean,
): Promise<{ entityTypes: Row[]; relationTypes: Row[] }> {
  const ets = await querier.query(
    `SELECT entity_type_id, key, display_name, description, created_at, updated_at
     FROM entity_type ORDER BY key`,
  );
  const rts = await querier.query(
    `SELECT relation_type_id, key, display_name, description, created_at, updated_at,
            source_entity_type_key AS source_key, target_entity_type_key AS target_key
     FROM relation_type ORDER BY key`,
  );
  const propertyCols = includePropertyTimestamps
    ? `${PROPERTY_COLS}, created_at, updated_at`
    : PROPERTY_COLS;
  const props = await querier.query(
    `SELECT ${propertyCols}, entity_type_id, relation_type_id
     FROM property_def ORDER BY key`,
  );

  // One bucket map serves both owner kinds: the exactly-one-owner rule
  // makes every property row's non-null owner id unique across tables.
  const propsByOwner = new Map<string, Row[]>();
  for (const raw of props.rows) {
    const { entityTypeId, relationTypeId, ...property } = camelizeRow(raw);
    const ownerId = (entityTypeId ?? relationTypeId) as string;
    const bucket = propsByOwner.get(ownerId) ?? [];
    bucket.push(property);
    propsByOwner.set(ownerId, bucket);
  }

  const entityTypes = ets.rows.map((raw) => {
    const et = camelizeRow(raw);
    et.properties = propsByOwner.get(et.entityTypeId as string) ?? [];
    return et;
  });
  const relationTypes = rts.rows.map((raw) => {
    const rt = camelizeRow(raw);
    rt.properties = propsByOwner.get(rt.relationTypeId as string) ?? [];
    return rt;
  });
  return { entityTypes, relationTypes };
}

/** Classify inclusion-join rows (carrying `entity_type_key` /
 * `relation_type_key` from their LEFT JOINs, exactly one non-null) into
 * the two `{key, properties}` lists of the port shape. */
export function splitInclusions(rows: Row[]): {
  entityInclusions: Row[];
  relationInclusions: Row[];
} {
  const entityInclusions: Row[] = [];
  const relationInclusions: Row[] = [];
  for (const raw of rows) {
    const properties = (raw.properties as string[] | null) ?? null;
    if (raw.entity_type_key !== null) {
      entityInclusions.push({ key: raw.entity_type_key, properties });
    } else {
      relationInclusions.push({ key: raw.relation_type_key, properties });
    }
  }
  return { entityInclusions, relationInclusions };
}
