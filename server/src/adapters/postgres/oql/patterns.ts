/**
 * The pattern emitter — the swappable module behind the `GRAPH_TABLE` seam.
 *
 * This is the **only** module that turns a pattern into table topology.
 * Expression walking, the WITH/CTE stages, projection and result
 * conversion never name a table or a join; replacing this module with a
 * SQL/PGQ `GRAPH_TABLE` emitter (PostgreSQL 19, out of scope) replaces
 * the whole mapping. The boundary is a named module, not a strategy
 * interface — there is no second implementation to abstract over yet.
 *
 * The mapping it emits:
 *
 * - A fixed-depth pattern is a chain of INNER JOINs. Each link condition
 *   attaches to the *later* of the two tables it references, so every ON
 *   only names tables already joined.
 * - A repeated variable reuses its alias and degenerates into extra ON
 *   conditions; a self-reference becomes both conditions on one alias;
 *   disconnected pattern parts become a filtered cartesian join.
 * - An OPTIONAL MATCH is ONE `LEFT JOIN` over the parenthesized
 *   inner-join tree of the pattern's new tables. That is what makes the
 *   match atomic — the whole pattern binds, or every variable is NULL.
 *   Naive LEFT JOIN chaining leaks partial matches on dirty data. Its
 *   WHERE and any condition referencing a pre-bound variable sit in the
 *   outer `ON`; pattern-internal conditions sit on the inner joins.
 */

import type {
  NodePatternContext,
  PatternContext,
  PatternElemContext,
} from "../../../core/oql/generated/CypherParser.js";
import { stripBackticks } from "../../../core/oql/index.js";
import { col, quoteIdent, type CompileState, type TableBinding, type TableKind } from "./bindings.js";
import { pendingSurface, reject } from "./rejections.js";

/** A join condition, and whether it names a variable bound before this
 * pattern — those must ride the outer ON of an OPTIONAL MATCH. */
interface JoinCondition {
  sql: string;
  outer: boolean;
}

/** One table the pattern introduces, with the conditions it carries. */
interface TableEntry {
  table: string;
  conds: JoinCondition[];
}

/** A pattern reduced to tables and conditions, before placement. */
export interface EmittedPattern {
  entries: TableEntry[];
  /** Conditions belonging to no new table — a re-bound variable whose
   * label is repeated. */
  loose: JoinCondition[];
}

/** Walk one MATCH pattern into table entries. Binds every new variable
 * into the open stage's scope as a side effect. */
export function emitPattern(pattern: PatternContext, state: CompileState): EmittedPattern {
  const emitted: EmittedPattern = { entries: [], loose: [] };
  /** Aliases this pattern introduces — everything else is pre-bound. */
  const fresh = new Set<string>();
  for (const part of pattern.patternPart()) {
    walkChain(part.patternElem(), emitted, fresh, state);
  }
  return emitted;
}

/** Place a plain MATCH: INNER JOINs, its WHERE in the stage WHERE. */
export function attachRequired(
  state: CompileState,
  emitted: EmittedPattern,
  whereSql: string | null,
): void {
  for (const entry of emitted.entries) {
    const conds = entry.conds.map((cond) => cond.sql);
    if (state.stage.from.length === 0) {
      state.stage.from.push(entry.table);
      state.stage.where.push(...conds);
    } else {
      state.stage.from.push(`JOIN ${entry.table} ON ${conds.join(" AND ") || "true"}`);
    }
  }
  state.stage.where.push(...emitted.loose.map((cond) => cond.sql));
  if (whereSql !== null) {
    state.stage.where.push(whereSql);
  }
}

/** Place an OPTIONAL MATCH: one LEFT JOIN over the pattern's join tree.
 * The WHERE belongs in the outer ON — placing it in the stage WHERE
 * silently *drops* unmatched rows instead of nulling them. */
export function attachOptional(
  state: CompileState,
  emitted: EmittedPattern,
  whereSql: string | null,
): void {
  const [first, ...rest] = emitted.entries;
  if (first === undefined) {
    pendingSurface("OPTIONAL MATCH whose pattern introduces no new variable");
  }
  // The leftmost operand has no inner ON to carry its conditions;
  // hoisting them to the outer ON is equivalent under LEFT JOIN.
  const outer: string[] = first.conds.map((cond) => cond.sql);
  let joined = first.table;
  for (const entry of rest) {
    const inner: string[] = [];
    for (const cond of entry.conds) {
      (cond.outer ? outer : inner).push(cond.sql);
    }
    joined += ` JOIN ${entry.table} ON ${inner.join(" AND ") || "true"}`;
  }
  if (rest.length > 0) {
    joined = `(${joined})`;
  }
  outer.push(...emitted.loose.map((cond) => cond.sql));
  if (whereSql !== null) {
    outer.push(whereSql);
  }
  state.stage.from.push(`LEFT JOIN ${joined} ON ${outer.length > 0 ? outer.join(" AND ") : "true"}`);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function walkChain(
  elem: PatternElemContext,
  emitted: EmittedPattern,
  fresh: Set<string>,
  state: CompileState,
): void {
  const parenthesized = elem.patternElem();
  if (parenthesized !== null) {
    walkChain(parenthesized, emitted, fresh, state);
    return;
  }
  const node = elem.nodePattern();
  if (node === null) {
    pendingSurface("a function invocation in pattern position");
  }

  let left = bindNode(node, emitted, fresh, state).binding;
  for (const link of elem.patternElemChain()) {
    const relPattern = link.relationshipPattern();
    const detail = relPattern.relationDetail();
    if (detail !== null && detail.properties() !== null) {
      pendingSurface("an inline property map on a relationship pattern");
    }

    const typesCtx = detail === null ? null : detail.relationshipTypes();
    const typeNames = typesCtx === null ? [] : typesCtx.name();
    if (typeNames.length > 1) {
      pendingSurface("a relationship-type union");
    }
    // No type written: the documented untyped case — it widens what the
    // pattern traverses and projects nothing typed.
    const typeKey = typeNames.length === 0 ? null : stripBackticks(typeNames[0]!.getText());

    const toRight = relPattern.GT() !== null;
    const toLeft = relPattern.LT() !== null;
    if (toRight === toLeft) {
      pendingSurface("an undirected or double-headed relationship pattern");
    }

    const symbolCtx = detail === null ? null : detail.symbol();
    const variable = symbolCtx === null ? null : stripBackticks(symbolCtx.getText());
    const rel = newBinding(state, "relation", typeKey, variable);
    fresh.add(rel.alias);

    const leftColumn = toRight ? "from_id" : "to_id";
    const rightColumn = toRight ? "to_id" : "from_id";
    const conds: JoinCondition[] = [];
    if (typeKey !== null) {
      conds.push({ sql: `${col(rel, "type_key")} = ${state.bindValue(typeKey)}`, outer: false });
    }
    conds.push({
      sql: `${col(rel, leftColumn)} = ${col(left, "id")}`,
      outer: !fresh.has(left.alias),
    });
    const relEntry: TableEntry = { table: `relation ${quoteIdent(rel.alias)}`, conds };
    emitted.entries.push(relEntry);

    const right = bindNode(link.nodePattern(), emitted, fresh, state, rel, rightColumn);
    if (right.rebound) {
      // The right table was joined earlier (or is carried) — its link
      // condition belongs to the relationship's entry.
      relEntry.conds.push({
        sql: `${col(rel, rightColumn)} = ${col(right.binding, "id")}`,
        outer: !fresh.has(right.binding.alias),
      });
    }
    left = right.binding;
  }
}

/** Bind — or re-find — a node pattern's variable. A new node gets its own
 * table entry carrying its type condition and, when it was reached
 * through a relationship, the link condition to it. */
function bindNode(
  node: NodePatternContext,
  emitted: EmittedPattern,
  fresh: Set<string>,
  state: CompileState,
  viaRel?: TableBinding,
  viaRelColumn?: string,
): { binding: TableBinding; rebound: boolean } {
  if (node.properties() !== null) {
    pendingSurface("an inline property map on a node pattern");
  }
  const symbolCtx = node.symbol();
  const variable = symbolCtx === null ? null : stripBackticks(symbolCtx.getText());
  const labelsCtx = node.nodeLabels();
  const labelNames = labelsCtx === null ? [] : labelsCtx.name();
  if (labelNames.length > 1) {
    pendingSurface("a multi-label node pattern");
  }
  const typeKey = labelNames.length === 0 ? null : stripBackticks(labelNames[0]!.getText());

  const existing = variable === null ? undefined : state.stage.scope.get(variable);
  if (existing !== undefined) {
    if (existing.kind !== "entity") {
      reject(`'${variable!}' is already bound to something that is not a node.`);
    }
    if (typeKey !== null) {
      // A repeated label narrows the same alias — a contradicting one
      // matches nothing, exactly as a second label would.
      emitted.loose.push({
        sql: `${col(existing, "type_key")} = ${state.bindValue(typeKey)}`,
        outer: !fresh.has(existing.alias),
      });
    }
    return { binding: existing, rebound: true };
  }

  const binding = newBinding(state, "entity", typeKey, variable);
  fresh.add(binding.alias);
  const conds: JoinCondition[] = [];
  if (typeKey !== null) {
    conds.push({ sql: `${col(binding, "type_key")} = ${state.bindValue(typeKey)}`, outer: false });
  }
  if (viaRel !== undefined && viaRelColumn !== undefined) {
    conds.push({ sql: `${col(binding, "id")} = ${col(viaRel, viaRelColumn)}`, outer: false });
  }
  emitted.entries.push({ table: `entity ${quoteIdent(binding.alias)}`, conds });
  return { binding, rebound: false };
}

function newBinding(
  state: CompileState,
  kind: TableKind,
  typeKey: string | null,
  variable: string | null,
): TableBinding {
  const binding: TableBinding = { kind, typeKey, alias: state.newAlias(kind, variable), carried: false };
  if (variable !== null) {
    state.stage.scope.set(variable, binding);
  }
  return binding;
}
