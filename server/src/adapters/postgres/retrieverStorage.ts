/** Targeted, additive retriever storage provisioning; no instance or vector writes. */
import { ValidationError } from "../../core/exceptions.js";
import { withTransaction, type Querier } from "./errors.js";
import { quoteIdent } from "./oql/bindings.js";

export const RETRIEVER_DDL = `CREATE TABLE IF NOT EXISTS retriever_config (
  retriever_config_id uuid CONSTRAINT retriever_config_pk PRIMARY KEY,
  lens_id uuid NOT NULL CONSTRAINT retriever_config_lens_fk REFERENCES lens(lens_id) ON DELETE CASCADE,
  key text NOT NULL,
  name text NOT NULL,
  description text,
  config_version integer NOT NULL,
  config jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT retriever_config_key_unique UNIQUE(lens_id, key)
)`;

export type RetrieverStorageStatus = "missing" | "ready" | "incompatible";
const columns: Record<string, [string, string, string | null]> = {
  retriever_config_id: ["uuid", "NO", null], lens_id: ["uuid", "NO", null],
  key: ["text", "NO", null], name: ["text", "NO", null], description: ["text", "YES", null],
  config_version: ["integer", "NO", null], config: ["jsonb", "NO", null],
  created_at: ["timestamp with time zone", "NO", "now()"],
  updated_at: ["timestamp with time zone", "NO", "now()"],
};
const constraints: Record<string, string> = {
  retriever_config_pk: "PRIMARY KEY (retriever_config_id)",
  retriever_config_lens_fk: "FOREIGN KEY (lens_id) REFERENCES lens(lens_id) ON DELETE CASCADE",
  retriever_config_key_unique: "UNIQUE (lens_id, key)",
};

export async function inspectRetrieverStorage(q: Querier, namespace: string): Promise<RetrieverStorageStatus> {
  const result = await q.query(`SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'retriever_config'`, [namespace]);
  if (!result.rows.length) return "missing";
  if (result.rows.length !== Object.keys(columns).length || result.rows.some(row => {
    const expected = columns[String(row.column_name)];
    return !expected || expected[0] !== row.data_type || expected[1] !== row.is_nullable || expected[2] !== row.column_default;
  })) return "incompatible";
  const defs = await q.query(`SELECT c.conname, c.contype, pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = $1 AND t.relname = 'retriever_config'`, [namespace]);
  const normalize = (value: string) => value.replaceAll('"', '').replaceAll(`${namespace}.`, '').replace(/\s+/g, ' ').trim();
  // PostgreSQL 18 exposes NOT NULL constraints here; column nullability is checked above.
  // Keep every other kind so unexpected structural constraints still fail closed.
  const structural = defs.rows.filter(row => row.contype !== "n");
  if (structural.length !== Object.keys(constraints).length || structural.some(row => {
    const expected = constraints[String(row.conname)];
    return !expected || normalize(String(row.definition)) !== normalize(expected);
  })) return "incompatible";
  return "ready";
}

function required(status: RetrieverStorageStatus = "missing"): never {
  throw new ValidationError(status === "incompatible" ? "Existing retriever storage is incompatible; no automatic repair." : "Retriever storage requires the targeted migration; existing ontology data is unchanged.", { code: status === "incompatible" ? "RETRIEVER_STORAGE_INCOMPATIBLE" : "RETRIEVER_MIGRATION_REQUIRED" });
}

export async function checkRetrieverStorageReady(namespace: string): Promise<void> {
  await withTransaction(async q => {
    const status = await inspectRetrieverStorage(q, namespace);
    if (status !== "ready") required(status);
  }, "READ COMMITTED", namespace);
}

/** Advisory lock, DDL and verification commit or roll back together per ontology. */
export async function ensureRetrieverStorage(namespace: string): Promise<"created" | "unchanged"> {
  return withTransaction(async q => {
    await q.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`retriever-storage:${namespace}`]);
    const owner = await q.query("SELECT key FROM public.ontology WHERE namespace = $1 FOR KEY SHARE", [namespace]);
    if (owner.rows.length !== 1) required();
    const before = await inspectRetrieverStorage(q, namespace);
    if (before === "incompatible") required(before);
    if (before === "ready") return "unchanged";
    // Fully qualify both tables: a stale/missing namespace cannot fall back to public.
    await q.query(RETRIEVER_DDL.replace("retriever_config (", `${quoteIdent(namespace)}.retriever_config (`)
      .replace("REFERENCES lens(", `REFERENCES ${quoteIdent(namespace)}.lens(`));
    const after = await inspectRetrieverStorage(q, namespace);
    if (after !== "ready") required(after);
    return "created";
  }, "READ COMMITTED", namespace);
}
