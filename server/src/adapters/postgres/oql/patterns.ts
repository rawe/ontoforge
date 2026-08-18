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
 * - An undirected relationship is one condition carrying both readings
 *   of the edge, so a two-ended match binds each row twice and a
 *   self-loop binds once — the reference adapter's row counts.
 * - An inline property map is one cast equality per key, on the join of
 *   the element that carries it.
 * - An OPTIONAL MATCH is ONE `LEFT JOIN` over the parenthesized
 *   inner-join tree of the pattern's new tables. That is what makes the
 *   match atomic — the whole pattern binds, or every variable is NULL.
 *   Naive LEFT JOIN chaining leaks partial matches on dirty data. Its
 *   WHERE and any condition referencing a pre-bound variable sit in the
 *   outer `ON`; pattern-internal conditions sit on the inner joins. When
 *   the pattern is wholly pre-bound it emits nothing at all: there is no
 *   variable to null out, and an OPTIONAL MATCH never removes a row.
 */

import type {
  NodePatternContext,
  PatternContext,
  PatternElemContext,
  PropertiesContext,
} from "../../../core/oql/generated/CypherParser.js";
import { stripBackticks } from "../../../core/oql/index.js";
import { col, quoteIdent, type CompileState, type TableBinding, type TableKind } from "./bindings.js";
import type { ExpressionWalker } from "./expressions.js";
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
export function emitPattern(
  pattern: PatternContext,
  state: CompileState,
  walker: ExpressionWalker,
): EmittedPattern {
  const emitted: EmittedPattern = { entries: [], loose: [] };
  /** Aliases this pattern introduces — everything else is pre-bound. */
  const fresh = new Set<string>();
  for (const part of pattern.patternPart()) {
    walkChain(part.patternElem(), emitted, fresh, state, walker);
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
    // Every element was already bound, so the pattern brings no table to
    // outer-join and no variable to null out. An OPTIONAL MATCH never
    // removes a row, so the degenerate form is a no-op — its conditions
    // and its WHERE are deliberately dropped rather than filtered on.
    return;
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
  walker: ExpressionWalker,
): void {
  const parenthesized = elem.patternElem();
  if (parenthesized !== null) {
    walkChain(parenthesized, emitted, fresh, state, walker);
    return;
  }
  const node = elem.nodePattern();
  if (node === null) {
    pendingSurface("a function invocation in pattern position");
  }

  let left = bindNode(node, emitted, fresh, state, walker).binding;
  for (const link of elem.patternElemChain()) {
    const relPattern = link.relationshipPattern();
    const detail = relPattern.relationDetail();

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
    if (toRight && toLeft) {
      pendingSurface("a double-headed relationship pattern");
    }
    const undirected = !toRight && !toLeft;

    const symbolCtx = detail === null ? null : detail.symbol();
    const variable = symbolCtx === null ? null : stripBackticks(symbolCtx.getText());
    const rel = newBinding(state, "relation", typeKey, variable);
    fresh.add(rel.alias);

    const conds: JoinCondition[] = [];
    if (typeKey !== null) {
      conds.push({ sql: `${col(rel, "type_key")} = ${state.bindValue(typeKey)}`, outer: false });
    }
    if (detail !== null) {
      conds.push(...inlineConditions(detail.properties(), rel, state, walker, false));
    }
    const relEntry: TableEntry = { table: `relation ${quoteIdent(rel.alias)}`, conds };
    emitted.entries.push(relEntry);

    if (undirected) {
      // Both readings of one edge, as one condition — it names the left
      // node, the relationship and the right node, so it can only attach
      // once the right node is joined. For `a = b` the two disjuncts are
      // the same test, which is what makes a self-loop bind once.
      const right = bindNode(link.nodePattern(), emitted, fresh, state, walker);
      const twoWay = {
        sql:
          `(${col(rel, "from_id")} = ${col(left, "id")}` +
          ` AND ${col(rel, "to_id")} = ${col(right.binding, "id")}` +
          ` OR ${col(rel, "from_id")} = ${col(right.binding, "id")}` +
          ` AND ${col(rel, "to_id")} = ${col(left, "id")})`,
        outer: !fresh.has(left.alias) || !fresh.has(right.binding.alias),
      };
      (right.rebound ? relEntry.conds : right.entry!.conds).push(twoWay);
      left = right.binding;
      continue;
    }

    const leftColumn = toRight ? "from_id" : "to_id";
    const rightColumn = toRight ? "to_id" : "from_id";
    relEntry.conds.push({
      sql: `${col(rel, leftColumn)} = ${col(left, "id")}`,
      outer: !fresh.has(left.alias),
    });

    const right = bindNode(link.nodePattern(), emitted, fresh, state, walker, rel, rightColumn);
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

/**
 * An inline property map → one equality per key, in written order, over
 * the encoding table's casts. The keys are lens-checked at validation and
 * again by the walker's own resolution, so a key that no longer resolves
 * refuses rather than silently matching nothing.
 */
function inlineConditions(
  propertiesCtx: PropertiesContext | null,
  binding: TableBinding,
  state: CompileState,
  walker: ExpressionWalker,
  outer: boolean,
): JoinCondition[] {
  if (propertiesCtx === null) {
    return [];
  }
  const map = propertiesCtx.mapLit();
  if (map === null) {
    // `(:person $props)` — a whole map behind one parameter cannot be
    // lens-checked at validation, so it never reaches here supported.
    pendingSurface("a parameter as an inline property map");
  }
  return map.mapPair().map((pair) => {
    const property = walker.propertyOf(binding, stripBackticks(pair.name().getText()));
    return { sql: `${property.sql} = ${walker.compile(pair.expression()).sql}`, outer };
  });
}

/** Bind — or re-find — a node pattern's variable. A new node gets its own
 * table entry carrying its type condition and, when it was reached
 * through a relationship, the link condition to it. */
function bindNode(
  node: NodePatternContext,
  emitted: EmittedPattern,
  fresh: Set<string>,
  state: CompileState,
  walker: ExpressionWalker,
  viaRel?: TableBinding,
  viaRelColumn?: string,
): { binding: TableBinding; rebound: boolean; entry?: TableEntry } {
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
    const outer = !fresh.has(existing.alias);
    if (typeKey !== null) {
      // A repeated label narrows the same alias — a contradicting one
      // matches nothing, exactly as a second label would.
      emitted.loose.push({
        sql: `${col(existing, "type_key")} = ${state.bindValue(typeKey)}`,
        outer,
      });
    }
    emitted.loose.push(...inlineConditions(node.properties(), existing, state, walker, outer));
    return { binding: existing, rebound: true };
  }

  const binding = newBinding(state, "entity", typeKey, variable);
  fresh.add(binding.alias);
  const conds: JoinCondition[] = [];
  if (typeKey !== null) {
    conds.push({ sql: `${col(binding, "type_key")} = ${state.bindValue(typeKey)}`, outer: false });
  }
  conds.push(...inlineConditions(node.properties(), binding, state, walker, false));
  if (viaRel !== undefined && viaRelColumn !== undefined) {
    conds.push({ sql: `${col(binding, "id")} = ${col(viaRel, viaRelColumn)}`, outer: false });
  }
  const entry: TableEntry = { table: `entity ${quoteIdent(binding.alias)}`, conds };
  emitted.entries.push(entry);
  return { binding, rebound: false, entry };
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
