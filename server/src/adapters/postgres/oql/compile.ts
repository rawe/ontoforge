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
import type { SchemaCacheValue } from "../../../runtime/schemaCache.js";
import {
  carriedColumns,
  col,
  quoteIdent,
  type Binding,
  type CompileState,
  type Stage,
  type TableBinding,
  type TableKind,
} from "./bindings.js";
import type { ColumnConversion } from "./conversion.js";
import { ExpressionWalker } from "./expressions.js";
import { attachOptional, attachRequired, emitPattern } from "./patterns.js";
import { pendingSurface, reject } from "./rejections.js";

/** One positional placeholder: a literal, or a named OQL parameter. */
export type Bind = { kind: "value"; value: unknown } | { kind: "param"; name: string };

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
    return params[bind.name];
  });
}

/** One projection item, already compiled. */
interface ProjectedItem {
  name: string;
  /** The projection form — what the SELECT list carries. */
  sql: string;
  isAggregate: boolean;
  dataType: string | null;
  binding?: TableBinding;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

class Compiler implements CompileState {
  private readonly binds: Bind[] = [];
  private readonly paramPositions = new Map<string, number>();
  private readonly ctes: string[] = [];
  private readonly aliases = new Set<string>();
  private readonly walker = new ExpressionWalker(this);
  private anonymous = 0;

  stage: Stage = { from: [], where: [], scope: new Map() };

  constructor(
    readonly schema: SchemaCacheValue,
    private readonly tokenStream: CommonTokenStream,
  ) {}

  // -- CompileState ---------------------------------------------------

  bindValue(value: unknown): string {
    this.binds.push({ kind: "value", value });
    return `$${this.binds.length}`;
  }

  bindParam(name: string): string {
    const existing = this.paramPositions.get(name);
    if (existing !== undefined) {
      return `$${existing}`;
    }
    this.binds.push({ kind: "param", name });
    this.paramPositions.set(name, this.binds.length);
    return `$${this.binds.length}`;
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
    const emitted = emitPattern(patternWhere.pattern(), this);
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
    if (itemsCtx.MULT() !== null) {
      pendingSurface("RETURN * / WITH *");
    }
    const items = itemsCtx.projectionItem().map((item): ProjectedItem => {
      const aliasCtx = item.symbol();
      const compiled = this.walker.compile(item.expression());
      return {
        name:
          aliasCtx === null
            ? this.verbatim(item.expression())
            : stripBackticks(aliasCtx.getText()),
        sql: compiled.raw,
        isAggregate: compiled.isAggregate,
        dataType: compiled.dataType,
        binding: compiled.binding,
      };
    });

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
          groupBy.push(item.sql);
        } else {
          for (const column of carriedColumns(item.binding)) {
            groupBy.push(col(item.binding, column));
          }
        }
      }
    }
    return { items, groupBy };
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
    this.ctes.push(`${name} AS (\n${this.statement(select, groupBy, body, projectedNames)}\n)`);
    this.stage = { from: [name], where: [], scope };
  }

  /** The RETURN: close the last stage into the outermost SELECT. */
  private closeFinal(body: ProjectionBodyContext): CompiledQuery {
    const { items, groupBy } = this.projection(body);
    const select = items.map((item) => `${item.sql} AS ${quoteIdent(item.name)}`);
    const projectedNames = new Set(items.map((item) => item.name));
    let sql = this.statement(select, groupBy, body, projectedNames);
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
    body: ProjectionBodyContext,
    projectedNames: Set<string>,
  ): string {
    const lines = [`SELECT ${select.join(", ")}`, `FROM ${this.stage.from.join("\n")}`];
    if (this.stage.where.length > 0) {
      lines.push(`WHERE ${this.stage.where.join(" AND ")}`);
    }
    if (groupBy.length > 0) {
      lines.push(`GROUP BY ${groupBy.join(", ")}`);
    }

    const order = body.orderSt();
    if (order !== null) {
      const keys = order.orderItem().map((item) => {
        const text = this.verbatim(item.expression());
        if (IDENTIFIER.test(text) && projectedNames.has(text) && !this.stage.scope.has(text)) {
          pendingSurface("ORDER BY on an output alias of the same projection");
        }
        const descending = item.DESC() !== null || item.DESCENDING() !== null;
        return this.walker.compile(item.expression()).sql + (descending ? " DESC" : "");
      });
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

  private pagingOperand(ctx: Parameters<ExpressionWalker["compile"]>[0]): string {
    const compiled = this.walker.compile(ctx);
    if (!/^\d+$/.test(compiled.sql)) {
      pendingSurface("a $parameter as a SKIP/LIMIT operand");
    }
    return compiled.sql;
  }

  private conversionFor(item: ProjectedItem): ColumnConversion {
    if (item.binding !== undefined) {
      const { kind, typeKey } = item.binding;
      const definition =
        typeKey === null
          ? undefined
          : kind === "entity"
            ? this.schema.entityTypes[typeKey]
            : this.schema.relationTypes[typeKey];
      const declared = Object.values(definition?.properties ?? {})
        .filter((property) => property.dataType === "datetime")
        .map((property) => property.key)
        .sort();
      return { kind, typeKey, datetimeKeys: ["_createdAt", "_updatedAt", ...declared] };
    }
    if (item.dataType === "count") {
      return { kind: "number" };
    }
    if (item.dataType === "datetime") {
      return { kind: "datetime" };
    }
    return { kind: "none" };
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
