/**
 * The storage version and the whole upgrade path
 * (`docs/decisions.md#storage`).
 *
 * One number in `public.storage_version` covers the whole server. The
 * boot transaction reads it under a database-wide advisory lock — so
 * several servers starting against one database upgrade it once — and
 * brings older storage up to date before the server serves requests:
 * every ontology namespace together, the number last. Any failure rolls
 * the whole upgrade back and stops the boot.
 *
 * New storage never runs a step: the ontology DDL in `ddl.ts` is always
 * the current layout, and an empty database is recorded at
 * `STORAGE_VERSION` directly.
 *
 * Changing the layout within a major line: change the ontology DDL, add
 * one step that only adds (tables, columns with a default, indexes) and
 * raise `STORAGE_VERSION` to its `to`. A released step is frozen — it
 * carries its own statements, never a constant shared with the DDL. A
 * major release deletes every step and raises `OLDEST_UPGRADABLE_VERSION`
 * to `STORAGE_VERSION`; its one major step may also rewrite data, so a
 * step's action is a statement or a function over the namespace.
 */

import { randomUUID } from "node:crypto";

import { legacyNameProperty } from "../../core/legacyNameProperty.js";
import type { Row } from "../../core/ports.js";
import { namePropertyDisplayName } from "../../core/schemas.js";
import { deriveManagedIndices, type SearchIndexSchema } from "../../core/searchIndex.js";
import type { Querier } from "./errors.js";
import { searchPathStatement } from "./errors.js";
import { readTypesWithProperties } from "./schemaRead.js";

/** The layout this code creates and serves. */
export const STORAGE_VERSION = 3;

/** The version the previous major line ended on; older storage is refused. */
export const OLDEST_UPGRADABLE_VERSION = 2;

/** Storage that predates the version table: the 5.x layout without retrievers. */
const UNVERSIONED = 1;

/** One action of a step inside an ontology namespace: a statement, or work
 * that needs code between statements (a backfill). */
type Action = string | ((querier: Querier) => Promise<void>);

/** One upgrade step: actions run, in order, inside every ontology
 * namespace to bring it from `to - 1` to `to`. */
interface Step {
  to: number;
  actions: Action[];
}

/**
 * Give every entity type a name property (`legacyNameProperty`), creating
 * a non-required string property where the type has none. Declaration
 * order is creation order.
 */
async function backfillNameProperties(querier: Querier): Promise<void> {
  const rows = (
    await querier.query(
      `SELECT et.entity_type_id, p.key, p.data_type
         FROM entity_type et
         LEFT JOIN property_def p ON p.entity_type_id = et.entity_type_id
        ORDER BY et.key, p.created_at, p.key`,
    )
  ).rows;
  const byType = new Map<string, { key: string; dataType: string }[]>();
  for (const row of rows) {
    const id = row["entity_type_id"] as string;
    const properties = byType.get(id) ?? [];
    if (row["key"] !== null) {
      properties.push({ key: row["key"] as string, dataType: row["data_type"] as string });
    }
    byType.set(id, properties);
  }
  for (const [entityTypeId, properties] of byType) {
    const { key, create } = legacyNameProperty(properties);
    if (create) {
      await querier.query(
        `INSERT INTO property_def
           (property_id, entity_type_id, key, display_name, data_type, required)
         VALUES ($1, $2, $3, $4, 'string', false)`,
        [randomUUID(), entityTypeId, key, namePropertyDisplayName(key)],
      );
    }
    await querier.query(`UPDATE entity_type SET name_property = $2 WHERE entity_type_id = $1`, [
      entityTypeId,
      key,
    ]);
  }
}

/**
 * Write a row for every managed search index the schema implies
 * (`deriveManagedIndices`) and include each in every scoped lens that
 * exposes its root type — by an entity inclusion of the type, or, with
 * relation inclusions only, every type. The worker's start then
 * reconciles their generations, which queues the full backfill.
 */
async function writeManagedSearchIndices(querier: Querier): Promise<void> {
  const { entityTypes, relationTypes } = await readTypesWithProperties(querier, false);
  const properties = (rows: unknown) =>
    Object.fromEntries(
      (rows as Row[]).map((p) => [
        p["key"] as string,
        {
          key: p["key"] as string,
          displayName: p["displayName"] as string,
          dataType: p["dataType"] as string,
        },
      ]),
    );
  const schema: SearchIndexSchema = {
    entityTypes: Object.fromEntries(
      entityTypes.map((et) => [
        et["key"] as string,
        {
          key: et["key"] as string,
          displayName: et["displayName"] as string,
          nameProperty: et["nameProperty"] as string,
          properties: properties(et["properties"]),
        },
      ]),
    ),
    relationTypes: Object.fromEntries(
      relationTypes.map((rt) => [
        rt["key"] as string,
        {
          key: rt["key"] as string,
          displayName: rt["displayName"] as string,
          fromEntityTypeKey: rt["sourceKey"] as string,
          toEntityTypeKey: rt["targetKey"] as string,
          properties: properties(rt["properties"]),
        },
      ]),
    ),
  };
  for (const { kind, definition } of deriveManagedIndices(schema)) {
    const searchIndexId = randomUUID();
    await querier.query(
      `INSERT INTO search_index (search_index_id, key, kind, entity_type_id, definition)
       SELECT $1::uuid, $2, $3, entity_type_id, $5::jsonb FROM entity_type WHERE key = $4`,
      [searchIndexId, definition.key, kind, definition.entityType, JSON.stringify(definition)],
    );
    await querier.query(
      `INSERT INTO lens_includes (lens_id, search_index_id)
       SELECT l.lens_id, si.search_index_id
       FROM search_index si, lens l
       WHERE si.search_index_id = $1 AND (
         EXISTS (SELECT 1 FROM lens_includes i
                 WHERE i.lens_id = l.lens_id AND i.entity_type_id = si.entity_type_id)
         OR (NOT EXISTS (SELECT 1 FROM lens_includes i
                         WHERE i.lens_id = l.lens_id AND i.entity_type_id IS NOT NULL)
             AND EXISTS (SELECT 1 FROM lens_includes i
                         WHERE i.lens_id = l.lens_id AND i.relation_type_id IS NOT NULL)))`,
      [searchIndexId],
    );
  }
}

const STEPS: Step[] = [
  {
    // 6.0: every entity type names its name property; search indices.
    to: 3,
    actions: [
      `ALTER TABLE entity_type ADD COLUMN name_property text`,
      backfillNameProperties,
      `ALTER TABLE entity_type ALTER COLUMN name_property SET NOT NULL`,
      `ALTER TABLE entity_type ADD CONSTRAINT entity_type_name_property_fk
  FOREIGN KEY (entity_type_id, name_property) REFERENCES property_def (entity_type_id, key)
  DEFERRABLE INITIALLY DEFERRED`,

      // 6.0: search indices — definitions, a third lens inclusion kind,
      // settings, generations, the work queue and the partitioned entries.
      `CREATE TABLE search_index (
  search_index_id uuid        CONSTRAINT search_index_pk PRIMARY KEY,
  key             text        NOT NULL CONSTRAINT search_index_key_unique UNIQUE,
  kind            text        NOT NULL CONSTRAINT search_index_kind_check
                              CHECK (kind IN ('default', 'passage', 'custom')),
  entity_type_id  uuid        NOT NULL CONSTRAINT search_index_entity_type_fk
                              REFERENCES entity_type (entity_type_id) ON DELETE CASCADE,
  definition      jsonb       NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
)`,
      `ALTER TABLE lens_includes ADD COLUMN search_index_id uuid
  CONSTRAINT lens_includes_search_index_fk
  REFERENCES search_index (search_index_id) ON DELETE CASCADE`,
      `ALTER TABLE lens_includes DROP CONSTRAINT lens_includes_one_type`,
      `ALTER TABLE lens_includes ADD CONSTRAINT lens_includes_one_type
  CHECK (num_nonnulls(entity_type_id, relation_type_id, search_index_id) = 1)`,
      `ALTER TABLE lens_includes ADD CONSTRAINT lens_includes_search_index_unique
  UNIQUE (lens_id, search_index_id)`,
      `CREATE TABLE search_settings (
  singleton          boolean NOT NULL DEFAULT true CONSTRAINT search_settings_pk PRIMARY KEY
                             CONSTRAINT search_settings_singleton CHECK (singleton),
  keyword_languages  text[]  NOT NULL,
  disabled_defaults  jsonb   NOT NULL DEFAULT '{}'::jsonb
)`,
      // The ontology keeps stemming in the one language it had.
      `INSERT INTO search_settings (keyword_languages)
  SELECT ARRAY[text_search_language] FROM public.ontology WHERE namespace = current_schema()`,
      `CREATE TABLE search_generation (
  generation_id   uuid        CONSTRAINT search_generation_pk PRIMARY KEY,
  search_index_id uuid        NOT NULL CONSTRAINT search_generation_search_index_fk
                              REFERENCES search_index (search_index_id) ON DELETE CASCADE,
  representation  text        NOT NULL CONSTRAINT search_generation_representation_check
                              CHECK (representation IN ('semantic', 'keyword')),
  definition_hash text        NOT NULL,
  model_id        text,
  dimensions      integer,
  languages       text[],
  state           text        NOT NULL CONSTRAINT search_generation_state_check
                              CHECK (state IN ('building', 'ready', 'retired', 'failed')),
  total           integer     NOT NULL DEFAULT 0,
  done            integer     NOT NULL DEFAULT 0,
  failed          integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  ready_at        timestamptz
)`,
      `CREATE UNIQUE INDEX search_generation_building_unique
  ON search_generation (search_index_id, representation) WHERE state = 'building'`,
      `CREATE UNIQUE INDEX search_generation_ready_unique
  ON search_generation (search_index_id, representation) WHERE state = 'ready'`,
      `CREATE TABLE search_queue (
  generation_id uuid        NOT NULL CONSTRAINT search_queue_generation_fk
                            REFERENCES search_generation (generation_id) ON DELETE CASCADE,
  entity_id     uuid        NOT NULL,
  part_kind     text        NOT NULL,
  group_no      integer     NOT NULL,
  part_id       text        NOT NULL,
  enqueued_at   timestamptz NOT NULL DEFAULT now(),
  attempts      integer     NOT NULL DEFAULT 0,
  not_before    timestamptz NOT NULL DEFAULT now(),
  lease_until   timestamptz,
  last_error    text,
  CONSTRAINT search_queue_pk PRIMARY KEY (generation_id, entity_id, part_kind, group_no, part_id)
)`,
      `CREATE INDEX search_queue_due_idx ON search_queue (not_before)`,
      `CREATE INDEX search_queue_entity_idx ON search_queue (entity_id)`,
      `CREATE INDEX search_queue_part_idx ON search_queue (part_id)`,
      `CREATE TABLE search_entry (
  generation_id uuid     NOT NULL,
  entity_id     uuid     NOT NULL,
  part_kind     text     NOT NULL,
  group_no      integer  NOT NULL,
  part_id       text     NOT NULL,
  relation_type text,
  target_type   text,
  target_id     uuid,
  start_char    integer,
  char_length   integer,
  text          text     NOT NULL,
  text_hash     bytea    NOT NULL,
  embedding     halfvec,
  tsv           tsvector,
  CONSTRAINT search_entry_pk PRIMARY KEY (generation_id, entity_id, part_kind, group_no, part_id)
) PARTITION BY LIST (generation_id)`,
      // 6.0: the managed indices of the existing schema, searchable in the
      // scoped lenses that show their types.
      writeManagedSearchIndices,
    ],
  },
];

/** Serializes the boot DDL and upgrade of every server on one database. */
const LOCK = `SELECT pg_advisory_xact_lock(hashtextextended('ontoforge.storage', 0))`;

/** The recorded version; `null` for an empty database. */
async function recordedVersion(querier: Querier): Promise<number | null> {
  const found = await querier.query(
    `SELECT to_regclass('public.storage_version') IS NOT NULL AS versioned,
            to_regclass('public.ontology') IS NOT NULL AS registry`,
  );
  const { versioned, registry } = found.rows[0]!;
  if (versioned) {
    const row = (await querier.query(`SELECT version FROM public.storage_version`)).rows[0];
    if (row !== undefined) return row["version"] as number;
  }
  return registry ? UNVERSIONED : null;
}

async function recordVersion(querier: Querier, version: number): Promise<void> {
  await querier.query(`DELETE FROM public.storage_version`);
  await querier.query(`INSERT INTO public.storage_version (version) VALUES ($1)`, [version]);
}

/**
 * Run the server-wide DDL and bring the storage to `STORAGE_VERSION`,
 * inside the caller's boot transaction. Throws — leaving the storage
 * untouched once the transaction rolls back — for storage newer than the
 * code or older than `OLDEST_UPGRADABLE_VERSION`.
 */
export async function bringStorageUpToDate(
  querier: Querier,
  serverDdl: readonly string[],
): Promise<void> {
  await querier.query(LOCK);
  const recorded = await recordedVersion(querier);
  if (recorded !== null && recorded > STORAGE_VERSION) {
    throw new Error(
      `Storage is version ${recorded}; this release supports up to version ` +
        `${STORAGE_VERSION}. Use a newer release.`,
    );
  }
  if (recorded !== null && recorded < OLDEST_UPGRADABLE_VERSION) {
    throw new Error(
      `Storage is version ${recorded}; this release upgrades from version ` +
        `${OLDEST_UPGRADABLE_VERSION} on. Upgrade through the last release of ` +
        `the previous major line first.`,
    );
  }
  for (const statement of serverDdl) {
    await querier.query(statement);
  }
  if (recorded === null) {
    await recordVersion(querier, STORAGE_VERSION);
    return;
  }
  if (recorded === STORAGE_VERSION) return;

  // No ontology may be created underneath the upgrade.
  await querier.query(`LOCK TABLE public.ontology IN SHARE MODE`);
  const namespaces = (await querier.query(`SELECT namespace FROM public.ontology ORDER BY key`))
    .rows.map((row) => row["namespace"] as string);
  console.log(
    `Upgrading storage from version ${recorded} to ${STORAGE_VERSION} ` +
      `(${namespaces.length} ontologies).`,
  );
  for (const step of STEPS.filter((candidate) => candidate.to > recorded)) {
    for (const namespace of namespaces) {
      await querier.query(searchPathStatement(namespace));
      for (const action of step.actions) {
        if (typeof action === "string") {
          await querier.query(action);
        } else {
          await action(querier);
        }
      }
    }
  }
  await querier.query(`SET LOCAL search_path TO public`);
  await recordVersion(querier, STORAGE_VERSION);
}
