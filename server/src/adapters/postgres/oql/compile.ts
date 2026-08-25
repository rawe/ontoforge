/**
 * The stage machine — the compiler's entry point.
 *
 * A query is a chain of stages. Each stage accumulates FROM/JOIN items,
 * WHERE conjuncts and a scope; a `WITH` closes the open stage into a CTE
 * and opens the next one over it, and the final `RETURN` closes the last
 * stage into the outermost SELECT. Aggregation rides Cypher's implicit
 * grouping: GROUP BY every non-aggregate projection item, a projected
 * node or relationship by its constituent columns. A `WITH … WHERE`
 * becomes the *next* stage's WHERE — after aggregation the aggregate is
 * an ordinary column, so no HAVING branch is needed. The grammar admits
 * at most one WITH today, so the CTE chain is at most two stages long;
 * nothing in the model depends on that.
 *
 * The machine delegates pattern → FROM/JOIN-tree emission to
 * `patterns.ts` and expression walking to `expressions.ts`, and never
 * names a table itself.
 *
 * Compilation reads `tree`, `tokenStream` and `schema` off the
 * `ValidatedQuery` — the same snapshot the query was validated against.
 * `text` is diagnostics only and is never compiled from. Compilation is
 * value-free: parameters become *named* binds resolved separately at
 * execution time, so one compiled query could be executed with any
 * argument map.
 */

import { Interval, type CommonTokenStream } from "antlr4ng";

import { StoreError } from "../../../core/exceptions.js";
import type {
  ProjectionBodyContext,
  ReadingStatementContext,
  ScriptContext,
  SinglePartQContext,
} from "../../../core/oql/generated/CypherParser.js";
import { stripBackticks, type ValidatedQuery } from "../../../core/oql/index.js";
import type { Row } from "../../../core/ports.js";
import {
  carriedColumns,
  col,
  projectedObject,
  quoteIdent,
  type Binding,
  type CompileState,
  type Stage,
  type TableBinding,
  type TableKind,
} from "./bindings.js";
import {
  objectConversion,
  scalarConversion,
  type ColumnConversion,
} from "./conversion.js";
import { ExpressionWalker } from "./expressions.js";
import { attachOptional, attachRequired, emitPattern } from "./patterns.js";
import { pendingSurface, reject } from "./rejections.js";

/**
 * One positional placeholder: a literal, or a named OQL parameter.
 *
 * A parameter carries how its argument must be shaped on the wire —
 * `json` for a list or map operand (the driver would otherwise send an
 * array literal), `paging` for a SKIP/LIMIT operand, whose value is the
 * one thing the validator could not check because it is not in the query
 * text.
 */
export type Bind =
  | { kind: "value"; value: unknown }
  | { kind: "param"; name: string; json?: boolean; paging?: boolean };

/** A compiled query: one SELECT, its bind plan, and the result contract. */
export interface CompiledQuery {
  sql: string;
  binds: Bind[];
  columns: string[];
  conversions: ColumnConversion[];
}

/** Compile a validated OQL query to a single SQL SELECT. */
export function compileOql(validated: ValidatedQuery): CompiledQuery {
  return new Compiler(validated.schema, validated.tokenStream).compile(validated.tree);
}

/** Resolve a compiled bind plan against the caller's argument map. */
export function bindValues(compiled: CompiledQuery, params: Row): unknown[] {
  return compiled.binds.map((bind) => {
    if (bind.kind === "value") {
      return bind.value;
    }
    if (!(bind.name in params)) {
      throw new StoreError(`Expected parameter: $${bind.name}`);
    }
    const value = params[bind.name];
    if (bind.paging === true && !isPagingCount(value)) {
      throw new StoreError(`SKIP/LIMIT takes a non-negative integer: $${bind.name}`);
    }
    return bind.json === true ? JSON.stringify(value ?? null) : value;
  });
}

/** A SKIP/LIMIT argument, in either of the shapes a caller supplies. */
function isPagingCount(value: unknown): boolean {
  if (typeof value === "string") {
    return /^\d+$/.test(value.trim());
  }
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** One projection item, already compiled. */
interface ProjectedItem {
  name: string;
  /** The projection form — what the SELECT list carries. */
  sql: string;
  /** The predicate and sort form, where it differs from the projection
   * form (a property access carries its cast there). */
  sortSql?: string;
  isAggregate: boolean;
  dataType: string | null;
  binding?: TableBinding;
  /** An explicit conversion plan the expression already knows. */
  conversion?: ColumnConversion;
}

/** One ORDER BY key: its SQL, its direction, and the output alias it
 * names where it names one (that alias is how the next stage reaches
 * it). */
interface OrderKey {
  sql: string;
  descending: boolean;
  alias: string | null;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

class Compiler implements CompileState {
  private readonly binds: Bind[] = [];
  private readonly paramPositions = new Map<string, number>();
  private readonly ctes: string[] = [];
  private readonly aliases = new Set<string>();
  private readonly walker = new ExpressionWalker(this);
  private anonymous = 0;
  /** The last stage's ordering, expressed over its CTE — re-emitted on
   * the outermost SELECT when the RETURN carries no ordering of its own
   * and does not aggregate the rows the keys belong to. */
  private carriedOrder: OrderKey[] = [];

  stage: Stage = { from: [], where: [], scope: new Map() };

  constructor(
    readonly schema: ValidatedQuery["schema"],
    private readonly tokenStream: CommonTokenStream,
  ) {}

  // -- CompileState ---------------------------------------------------

  bindValue(value: unknown): string {
    this.binds.push({ kind: "value", value });
    return `$${this.binds.length}`;
  }

  bindParam(name: string): string {
    return this.parameter(name, false);
  }

  bindParamJson(name: string): string {
    return this.parameter(name, true);
  }

  /** One position per (parameter, wire shape) pair: the same name used
   * both as a scalar and as a list needs two, encoded differently. */
  private parameter(name: string, asJson: boolean): string {
    const key = asJson ? `json:${name}` : name;
    const existing = this.paramPositions.get(key);
    if (existing !== undefined) {
      return `$${existing}`;
    }
    this.binds.push(asJson ? { kind: "param", name, json: true } : { kind: "param", name });
    this.paramPositions.set(key, this.binds.length);
    return `$${this.binds.length}`;
  }

  aggregateOrder(): string {
    if (this.carriedOrder.length === 0) {
      return "";
    }
    const keys = this.carriedOrder.map((key) => (key.descending ? `${key.sql} DESC` : key.sql));
    return ` ORDER BY ${keys.join(", ")}`;
  }

  newAlias(kind: TableKind, variable: string | null): string {
    if (variable !== null) {
      this.aliases.add(variable);
      return variable;
    }
    let alias: string;
    do {
      alias = `_${kind === "entity" ? "e" : "r"}${this.anonymous++}`;
    } while (this.aliases.has(alias));
    this.aliases.add(alias);
    return alias;
  }

  // -- the stage chain ------------------------------------------------

  compile(tree: ScriptContext): CompiledQuery {
    const regular = tree.query()?.regularQuery();
    if (regular === undefined || regular === null) {
      pendingSurface("a standalone CALL");
    }
    if (regular.unionSt().length > 0) {
      pendingSurface("UNION");
    }
    const single = regular.singleQuery()!;

    let last: SinglePartQContext;
    const multi = single.multiPartQ();
    if (multi === null) {
      last = single.singlePartQ()!;
    } else {
      for (const reading of multi.readingStatement()) {
        this.reading(reading);
      }
      const withSt = multi.withSt();
      this.closeIntoCte(withSt.projectionBody());
      const where = withSt.where();
      if (where !== null) {
        this.stage.where.push(this.walker.compile(where.expression()).sql);
      }
      last = multi.singlePartQ();
    }

    for (const reading of last.readingStatement()) {
      this.reading(reading);
    }
    const returnSt = last.returnSt();
    if (returnSt === null) {
      pendingSurface("a query without RETURN");
    }
    return this.closeFinal(returnSt.projectionBody());
  }

  /** One MATCH / OPTIONAL MATCH: pattern first (it binds the scope the
   * WHERE reads), then the WHERE, then placement. */
  private reading(ctx: ReadingStatementContext): void {
    const match = ctx.matchSt();
    if (match === null) {
      pendingSurface("a reading clause other than MATCH");
    }
    const patternWhere = match.patternWhere();
    const emitted = emitPattern(patternWhere.pattern(), this, this.walker);
    const where = patternWhere.where();
    const whereSql = where === null ? null : this.walker.compile(where.expression()).sql;
    if (match.OPTIONAL() === null) {
      attachRequired(this, emitted, whereSql);
    } else {
      attachOptional(this, emitted, whereSql);
    }
  }

  // -- projections ----------------------------------------------------

  private projection(body: ProjectionBodyContext): {
    items: ProjectedItem[];
    groupBy: string[];
  } {
    const itemsCtx = body.projectionItems();
    const items: ProjectedItem[] = [];
    if (itemsCtx.MULT() !== null) {
      // `RETURN *` / `WITH *`: every variable in scope, named after
      // itself, in the reference adapter's alphabetical order. Anonymous
      // pattern elements never enter the scope, so they never expand.
      for (const name of [...this.stage.scope.keys()].sort()) {
        items.push(this.scopeItem(name));
      }
    }
    for (const item of itemsCtx.projectionItem()) {
      const aliasCtx = item.symbol();
      const compiled = this.walker.compile(item.expression());
      items.push({
        name:
          aliasCtx === null
            ? this.verbatim(item.expression())
            : stripBackticks(aliasCtx.getText()),
        sql: compiled.raw,
        sortSql: compiled.sql,
        isAggregate: compiled.isAggregate,
        dataType: compiled.dataType,
        binding: compiled.binding,
        conversion: compiled.conversion,
      });
    }

    const groupBy: string[] = [];
    if (items.some((item) => item.isAggregate)) {
      for (const item of items) {
        if (item.isAggregate) {
          continue;
        }
        // Cypher's implicit grouping key. A projected node or
        // relationship groups by its constituent columns — the primary
        // key alone would do, but PostgreSQL only infers functional
        // dependency for a base table, never for a CTE.
        if (item.binding === undefined) {
          // Both forms of the same property: a grouped property must
          // stay a grouping key when ORDER BY or WHERE reads it through
          // its cast, and the two forms determine each other, so the
          // groups are the same ones either way.
          groupBy.push(item.sql);
          if (item.sortSql !== undefined && item.sortSql !== item.sql) {
            groupBy.push(item.sortSql);
          }
        } else {
          for (const column of carriedColumns(item.binding)) {
            groupBy.push(col(item.binding, column));
          }
        }
      }
    }
    return { items, groupBy };
  }

  /** One in-scope variable, projected under its own name. */
  private scopeItem(name: string): ProjectedItem {
    const binding = this.stage.scope.get(name)!;
    if (binding.kind === "scalar") {
      return {
        name,
        sql: binding.sqlExpr,
        isAggregate: false,
        dataType: binding.dataType,
        conversion: binding.conversion,
      };
    }
    return {
      name,
      sql: projectedObject(binding),
      isAggregate: false,
      dataType: null,
      binding,
    };
  }

  /** A WITH: close the open stage into a CTE and open the next over it. */
  private closeIntoCte(body: ProjectionBodyContext): void {
    const { items, groupBy } = this.projection(body);
    const name = `s${this.ctes.length}`;
    const select: string[] = [];
    const scope = new Map<string, Binding>();

    for (const item of items) {
      if (!IDENTIFIER.test(item.name)) {
        reject(`WITH must alias every item that is not a plain variable: '${item.name}'.`);
      }
      if (item.binding === undefined) {
        select.push(`${item.sql} AS ${quoteIdent(item.name)}`);
        scope.set(item.name, {
          kind: "scalar",
          dataType: item.dataType,
          sqlExpr: `${name}.${quoteIdent(item.name)}`,
          conversion: this.conversionFor(item),
        });
      } else {
        // A node or relationship variable survives a WITH as its
        // exploded columns; `col()` hides the change from every reader.
        for (const column of carriedColumns(item.binding)) {
          select.push(`${col(item.binding, column)} AS ${quoteIdent(`${item.name}__${column}`)}`);
        }
        scope.set(item.name, {
          kind: item.binding.kind,
          typeKey: item.binding.typeKey,
          alias: name,
          carried: true,
          prefix: item.name,
        });
      }
    }

    const projectedNames = new Set(items.map((item) => item.name));
    const keys = this.orderKeys(body, projectedNames);
    // Neo4j preserves the pipeline's last ordering all the way out, but
    // SQL does not promise a CTE's order survives the outer SELECT — so
    // every sort key is carried out of the stage (an output column of
    // its own where it is an expression) for the RETURN to re-order on.
    this.carriedOrder = keys.map((key, index) => {
      if (key.alias !== null) {
        return {
          sql: `${name}.${quoteIdent(key.alias)}`,
          descending: key.descending,
          alias: null,
        };
      }
      const column = `__ord${index}`;
      select.push(`${key.sql} AS ${column}`);
      return { sql: `${name}.${column}`, descending: key.descending, alias: null };
    });

    this.ctes.push(`${name} AS (\n${this.statement(select, groupBy, keys, body)}\n)`);
    this.stage = { from: [name], where: [], scope };
  }

  /** The RETURN: close the last stage into the outermost SELECT. */
  private closeFinal(body: ProjectionBodyContext): CompiledQuery {
    const { items, groupBy } = this.projection(body);
    const select = items.map((item) => `${item.sql} AS ${quoteIdent(item.name)}`);
    const projectedNames = new Set(items.map((item) => item.name));
    const own = this.orderKeys(body, projectedNames);
    // A carried sort key is a column of the rows the projection reads. An
    // aggregating projection collapses those rows, so the key is neither
    // grouped nor aggregated and re-emitting it is invalid SQL — and row
    // identity does not survive aggregation in Cypher either, so there is
    // no ordering left to preserve. Only the RETURN's own keys apply.
    const aggregating = items.some((item) => item.isAggregate);
    const carried = aggregating ? [] : this.carriedOrder;
    let sql = this.statement(select, groupBy, own.length > 0 ? own : carried, body);
    if (this.ctes.length > 0) {
      sql = `WITH ${this.ctes.join(",\n")}\n${sql}`;
    }
    return {
      sql,
      binds: this.binds,
      columns: items.map((item) => item.name),
      conversions: items.map((item) => this.conversionFor(item)),
    };
  }

  /** SELECT … FROM … WHERE … GROUP BY … ORDER BY … LIMIT … OFFSET …,
   * one clause per line. */
  private statement(
    select: string[],
    groupBy: string[],
    order: OrderKey[],
    body: ProjectionBodyContext,
  ): string {
    const lines = [`SELECT ${select.join(", ")}`, `FROM ${this.stage.from.join("\n")}`];
    if (this.stage.where.length > 0) {
      lines.push(`WHERE ${this.stage.where.join(" AND ")}`);
    }
    if (groupBy.length > 0) {
      lines.push(`GROUP BY ${groupBy.join(", ")}`);
    }
    if (order.length > 0) {
      const keys = order.map((key) => (key.descending ? `${key.sql} DESC` : key.sql));
      lines.push(`ORDER BY ${keys.join(", ")}`);
    }
    // LIMIT before OFFSET is the PostgreSQL convention; the two clauses
    // are order-independent.
    const limit = body.limitSt();
    if (limit !== null) {
      lines.push(`LIMIT ${this.pagingOperand(limit.expression())}`);
    }
    const skip = body.skipSt();
    if (skip !== null) {
      lines.push(`OFFSET ${this.pagingOperand(skip.expression())}`);
    }
    return lines.join("\n");
  }

  /** The sort keys of one projection body, compiled in the stage that
   * owns them. A key naming an output alias of this very projection is
   * not an expression to walk — SQL resolves a bare output name in ORDER
   * BY against the SELECT list, exactly as Cypher does. */
  private orderKeys(body: ProjectionBodyContext, projectedNames: Set<string>): OrderKey[] {
    const order = body.orderSt();
    if (order === null) {
      return [];
    }
    return order.orderItem().map((item) => {
      const text = this.verbatim(item.expression());
      const isAlias =
        IDENTIFIER.test(text) && projectedNames.has(text) && !this.stage.scope.has(text);
      return {
        sql: isAlias ? quoteIdent(text) : this.walker.compile(item.expression()).sql,
        descending: item.DESC() !== null || item.DESCENDING() !== null,
        alias: isAlias ? text : null,
      };
    });
  }

  /** A non-negative integer literal (inlined — the count position is
   * not a value position, and the canonical integer carries no user
   * text) or a `$parameter` (a bind whose value the validator could not
   * see, so it is checked when the argument map arrives). */
  private pagingOperand(ctx: Parameters<ExpressionWalker["compile"]>[0]): string {
    const compiled = this.walker.compile(ctx);
    const constant = compiled.constant?.value;
    if (typeof constant === "number" && Number.isSafeInteger(constant) && constant >= 0) {
      return String(constant);
    }
    const position = /^\$(\d+)$/.exec(compiled.sql);
    if (position === null) {
      pendingSurface("a SKIP/LIMIT operand that is neither an integer nor a $parameter");
    }
    const bind = this.binds[Number(position[1]) - 1]!;
    if (bind.kind !== "param") {
      pendingSurface("a SKIP/LIMIT operand that is neither an integer nor a $parameter");
    }
    bind.paging = true;
    return compiled.sql;
  }

  private conversionFor(item: ProjectedItem): ColumnConversion {
    if (item.conversion !== undefined) {
      return item.conversion;
    }
    if (item.binding !== undefined) {
      return objectConversion(this.schema, item.binding);
    }
    return scalarConversion(item.dataType);
  }

  /** The verbatim source text of a parse-tree slice — the result
   * contract's column name. `getText()` would eat the whitespace. */
  private verbatim(ctx: { start: { tokenIndex: number } | null; stop: { tokenIndex: number } | null }): string {
    if (ctx.start === null || ctx.stop === null) {
      return "?";
    }
    return this.tokenStream.getTextFromInterval(
      Interval.of(ctx.start.tokenIndex, ctx.stop.tokenIndex),
    );
  }
}
