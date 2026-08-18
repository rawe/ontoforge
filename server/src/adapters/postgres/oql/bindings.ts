/**
 * The binding abstraction — one variable, two physical forms.
 *
 * A node or relationship variable is a **table alias** over `entity` /
 * `relation` while its stage is open. Crossing a `WITH` it becomes the
 * exploded columns of the stage CTE (`x__id`, `x__type_key`, `x__props`,
 * …). `col(binding, column)` is what makes the two forms
 * indistinguishable to every consumer — property access, object
 * projection and grouping read a column the same way in both.
 *
 * Relationship variables carry `from_id`/`to_id` alongside the shared
 * columns, so a carried relationship can still be joined against.
 *
 * Nothing here knows about the parse tree; the pattern emitter and the
 * expression walker both build on it through `CompileState`.
 */

import type { ValidatedQuery } from "../../../core/oql/index.js";
import type { ColumnConversion } from "./conversion.js";

export type TableKind = "entity" | "relation";

/** A node or relationship variable. `typeKey` is null for a pattern
 * element written without a label / relationship type — the documented
 * untyped case, which widens traversal but projects nothing typed. */
export interface TableBinding {
  kind: TableKind;
  typeKey: string | null;
  /** The table alias, or the CTE name once the variable is carried. */
  alias: string;
  /** True once the variable crossed a WITH. */
  carried: boolean;
  /** Column-name prefix of the exploded form (the WITH alias). */
  prefix?: string;
}

/** A scalar carried out of a WITH projection (`WITH count(*) AS n`). */
export interface ScalarBinding {
  kind: "scalar";
  dataType: string | null;
  sqlExpr: string;
  /** The conversion the value needed in the stage that computed it —
   * carried across the WITH so `RETURN collect(a) AS xs` still rebuilds
   * the collected objects' dates. */
  conversion: ColumnConversion;
}

export type Binding = TableBinding | ScalarBinding;

/** The columns a carried variable explodes into, per kind. */
const ENTITY_COLUMNS = ["id", "type_key", "props", "created_at", "updated_at"] as const;
const RELATION_COLUMNS = [
  "id",
  "type_key",
  "from_id",
  "to_id",
  "props",
  "created_at",
  "updated_at",
] as const;

export function carriedColumns(binding: TableBinding): readonly string[] {
  return binding.kind === "entity" ? ENTITY_COLUMNS : RELATION_COLUMNS;
}

/** An entity or relation type as the scoped schema holds it. */
type TypeDefinition =
  | ValidatedQuery["schema"]["entityTypes"][string]
  | ValidatedQuery["schema"]["relationTypes"][string];

/** The schema definition a binding names — the one place the two type
 * tables are chosen between. Undefined for an element written without a
 * label or relationship type (the untyped case), and for a key the lens
 * no longer resolves. */
export function typeDefinition(
  schema: ValidatedQuery["schema"],
  binding: TableBinding,
): TypeDefinition | undefined {
  const { kind, typeKey } = binding;
  if (typeKey === null) {
    return undefined;
  }
  return kind === "entity" ? schema.entityTypes[typeKey] : schema.relationTypes[typeKey];
}

/** One column of a table binding, in whichever form the binding is in. */
export function col(binding: TableBinding, column: string): string {
  return binding.carried
    ? `${binding.alias}.${quoteIdent(`${binding.prefix}__${column}`)}`
    : `${quoteIdent(binding.alias)}.${column}`;
}

/**
 * `RETURN a` / `RETURN r` — the Neo4j-shaped property map.
 *
 * The `CASE` guard is what makes an unmatched OPTIONAL MATCH project SQL
 * NULL instead of an all-nulls object. Relationship endpoints are
 * deliberately absent: they are structural, not properties
 * (`docs/capabilities/oql.md`). The `embedding` column is never named
 * here, so vector stripping is satisfied by construction.
 */
export function projectedObject(binding: TableBinding): string {
  const typeKeyName = binding.kind === "entity" ? "_entityTypeKey" : "_relationTypeKey";
  return (
    `CASE WHEN ${col(binding, "id")} IS NULL THEN NULL ELSE jsonb_build_object(` +
    `'_id', ${col(binding, "id")}::text, '${typeKeyName}', ${col(binding, "type_key")}, ` +
    `'_createdAt', ${col(binding, "created_at")}, '_updatedAt', ${col(binding, "updated_at")})` +
    ` || ${col(binding, "props")} END`
  );
}

/** Reserved words that must not appear unquoted as an identifier. */
const PG_KEYWORDS: ReadonlySet<string> = new Set([
  "all", "analyse", "analyze", "and", "any", "array", "as", "asc", "asymmetric", "authorization",
  "binary", "both", "case", "cast", "check", "collate", "collation", "column", "concurrently",
  "constraint", "create", "cross", "current_catalog", "current_date", "current_role",
  "current_schema", "current_time", "current_timestamp", "current_user", "default", "deferrable",
  "desc", "distinct", "do", "else", "end", "except", "false", "fetch", "for", "foreign", "freeze",
  "from", "full", "grant", "group", "having", "ilike", "in", "initially", "inner", "intersect",
  "into", "is", "isnull", "join", "lateral", "leading", "left", "like", "limit", "localtime",
  "localtimestamp", "natural", "not", "notnull", "null", "offset", "on", "only", "or", "order",
  "outer", "overlaps", "placing", "primary", "references", "returning", "right", "select",
  "session_user", "similar", "some", "symmetric", "system_user", "table", "tablesample", "then",
  "to", "trailing", "true", "union", "unique", "user", "using", "variadic", "verbose", "when",
  "where", "window", "with",
]);

/** Quote an identifier unless it is already an unambiguous lower-case one. */
export function quoteIdent(name: string): string {
  return /^[a-z_][a-z0-9_]*$/.test(name) && !PG_KEYWORDS.has(name)
    ? name
    : `"${name.replaceAll('"', '""')}"`;
}

/** One SQL stage: its FROM/JOIN items, its WHERE conjuncts, its scope. */
export interface Stage {
  /** The first entry is the FROM item; the rest are JOIN clauses. */
  from: string[];
  where: string[];
  scope: Map<string, Binding>;
}

/**
 * What the pattern emitter and the expression walker need from the stage
 * machine: the open stage, the bind plan, and alias allocation.
 */
export interface CompileState {
  readonly schema: ValidatedQuery["schema"];
  stage: Stage;
  /** Bind a literal value; returns its `$n` placeholder. */
  bindValue(value: unknown): string;
  /** Bind a named OQL parameter (deduplicated); returns its `$n`. */
  bindParam(name: string): string;
  /** Bind a named OQL parameter in **jsonb** form — the value is JSON
   * encoded at bind time so a list or map argument arrives as jsonb
   * rather than as the driver's array literal. Deduplicated separately
   * from the scalar form; returns its `$n`. */
  bindParamJson(name: string): string;
  /** A fresh table alias for a variable, or for an anonymous element. */
  newAlias(kind: TableKind, variable: string | null): string;
}
