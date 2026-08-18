/**
 * OQL → SQL for the PostgreSQL adapter.
 *
 * A tree-walking compiler over the closed OQL surface, split at the
 * model's joints:
 *
 * - `compile.ts` — the stage machine and the entry point.
 * - `patterns.ts` — the pattern emitter, the one module that knows table
 *   topology (the seam a future SQL/PGQ `GRAPH_TABLE` emitter replaces).
 * - `expressions.ts` — the expression walker.
 * - `conversion.ts` — the compile-time result-conversion plan.
 * - `bindings.ts` — the binding abstraction the other three share.
 *
 * Read-only by construction: there is no code path here that emits
 * anything but one SELECT, and every value is a bound parameter.
 */

export { bindValues, compileOql, type Bind, type CompiledQuery } from "./compile.js";
export { convertRows, type ColumnConversion } from "./conversion.js";
