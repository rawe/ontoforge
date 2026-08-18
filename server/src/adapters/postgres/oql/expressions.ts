/**
 * The expression walker.
 *
 * Every expression compiles to **three** forms from one schema lookup:
 *
 * - `sql` — predicate and sort form. Property access carries the
 *   encoding table's cast (`(props->'age')::numeric`).
 * - `raw` — value and projection form. Property access stays raw jsonb
 *   (`props->'age'`): the driver parses it back, numbers stay numbers
 *   because the port caps them at ±2^53, and a `::numeric` projection
 *   would come back from `pg` as a *string*. A node or relationship
 *   variable projects as its full object.
 * - `json` — jsonb form, read only where a list is involved: `IN`, list
 *   and map literals, list equality. It is computed on demand because a
 *   parameter's jsonb form costs a bind position of its own.
 *
 * The seven aggregates live here too. Two of them bend SQL's empty-group
 * answer to Cypher's — `sum` yields 0, `collect` yields `[]` — and
 * `collect` additionally drops nulls, which `jsonb_agg` does not.
 *
 * **Symbol-atom disambiguation is the named first step.** Bare integers
 * parse as *symbols*, not literals — `10` and `1_000` lex as `Integer`,
 * `0` and `007` as `ID`, and all of them reach the compiler through the
 * same rule as a variable reference. So every symbol atom resolves in
 * order: scope lookup first, then a numeric-content test (decimal with
 * underscores stripped, `0x…` hex, `0o…` octal — Cypher's literal
 * forms), and otherwise it is an unresolved symbol and the query is
 * rejected. `-5` and `1.5` do arrive as literals; `-5` is one token.
 *
 * Nothing user-originated ever reaches the SQL text: parameters and
 * literals alike become positional binds. Property keys are inlined —
 * they are schema keys, matched against the scoped schema first (which
 * is also what closes the validator's blind spot on WITH aliases) and
 * constrained to `[a-z][a-z0-9_]*` by the modeling surface.
 */

import type {
  AtomContext,
  AtomicExpressionContext,
  ComparisonExpressionContext,
  ExpressionContext,
  FunctionInvocationContext,
  ListLitContext,
  MapLitContext,
  PropertyOrLabelExpressionContext,
  UnaryAddSubExpressionContext,
  XorExpressionContext,
} from "../../../core/oql/generated/CypherParser.js";
import { stripBackticks, unknownPropertyMessage } from "../../../core/oql/index.js";
import type { PropertyDef } from "../../../core/schemas.js";
import { jsonAccessor } from "../filters.js";
import {
  col,
  projectedObject,
  type Binding,
  type CompileState,
  type TableBinding,
} from "./bindings.js";
import {
  aggregateConversion,
  objectConversion,
  scalarConversion,
  type ColumnConversion,
} from "./conversion.js";
import { pendingSurface, reject } from "./rejections.js";

/** A compiled expression in its three forms, plus what the stage machine
 * needs to know about it. */
export interface CompiledExpr {
  /** Predicate / sort form. */
  sql: string;
  /** Value / projection form. */
  raw: string;
  /** jsonb form — what `IN`, list literals and map literals compose
   * from, so that list membership and list equality are the structural
   * jsonb ones, with jsonb's numeric normalization. Computed on
   * demand: a parameter's jsonb form needs a bind position of its own
   * (the argument is JSON encoded rather than sent as an array literal),
   * and that position must not exist unless something reads the form. */
  json: () => string;
  /** The declared data type where one is known. */
  dataType: string | null;
  /** Set when the expression IS a bare node/relationship variable. */
  binding?: TableBinding;
  isAggregate: boolean;
  /** An explicit result-conversion plan, where the expression knows one
   * the stage machine could not infer from `dataType` alone. */
  conversion?: ColumnConversion;
  /** The compile-time value of a constant literal — what lets a wholly
   * constant list or map fold into a single jsonb bind. */
  constant?: { value: unknown };
}

function scalar(sql: string, dataType: string | null, json?: () => string): CompiledExpr {
  return { sql, raw: sql, json: json ?? (() => `to_jsonb(${sql})`), dataType, isAggregate: false };
}

export class ExpressionWalker {
  constructor(private readonly state: CompileState) {}

  compile(ctx: ExpressionContext): CompiledExpr {
    const operands = ctx.xorExpression().map((operand) => this.xor(operand));
    return chain(operands, "OR");
  }

  private xor(ctx: XorExpressionContext): CompiledExpr {
    const operands = ctx.andExpression();
    if (operands.length > 1) {
      pendingSurface("XOR");
    }
    const nots = operands[0]!.notExpression().map((notCtx) => {
      const inner = this.comparison(notCtx.comparisonExpression());
      return notCtx.NOT().length % 2 === 1 ? scalar(`NOT (${inner.sql})`, "boolean") : inner;
    });
    return chain(nots, "AND");
  }

  private comparison(ctx: ComparisonExpressionContext): CompiledExpr {
    const operands = ctx.addSubExpression().map((operand) => {
      const multDiv = operand.multDivExpression();
      if (multDiv.length > 1) {
        pendingSurface("arithmetic");
      }
      const power = multDiv[0]!.powerExpression();
      if (power.length > 1) {
        pendingSurface("arithmetic");
      }
      const unary = power[0]!.unaryAddSubExpression();
      if (unary.length > 1) {
        pendingSurface("arithmetic");
      }
      return this.unary(unary[0]!);
    });
    if (operands.length === 1) {
      return operands[0]!;
    }
    if (operands.length > 2) {
      pendingSurface("a chained comparison");
    }
    const sign = ctx.comparisonSigns()[0]!;
    const operator =
      sign.ASSIGN() !== null
        ? "="
        : sign.NOT_EQUAL() !== null
          ? "<>"
          : sign.LE() !== null
            ? "<="
            : sign.GE() !== null
              ? ">="
              : sign.LT() !== null
                ? "<"
                : ">";
    return scalar(`${operands[0]!.sql} ${operator} ${operands[1]!.sql}`, "boolean");
  }

  private unary(ctx: UnaryAddSubExpressionContext): CompiledExpr {
    const inner = this.atomic(ctx.atomicExpression());
    if (ctx.SUB() === null) {
      return inner;
    }
    if (!/^-?\d+(\.\d+)?$/.test(inner.sql)) {
      pendingSurface("unary minus on a non-literal");
    }
    return numberExpr({ sql: `-${inner.sql}`, dataType: inner.dataType ?? "integer" });
  }

  private atomic(ctx: AtomicExpressionContext): CompiledExpr {
    const base = this.propertyOrLabel(ctx.propertyOrLabelExpression());
    const strings = ctx.stringExpression();
    const nulls = ctx.nullExpression();
    const lists = ctx.listExpression();
    if (strings.length + nulls.length + lists.length > 1) {
      pendingSurface("a chained postfix expression");
    }
    const listExp = lists[0];
    if (listExp !== undefined) {
      if (listExp.IN() === null) {
        // Indexing and slicing (`xs[0]`, `xs[1..3]`) parse, but the
        // documented OQL surface names neither.
        pendingSurface("list indexing");
      }
      return this.membership(base, this.propertyOrLabel(listExp.propertyOrLabelExpression()!));
    }
    const stringExp = strings[0];
    if (stringExp !== undefined) {
      if (stringExp.stringExpPrefix().CONTAINS() === null) {
        pendingSurface("STARTS WITH / ENDS WITH");
      }
      // Cypher's CONTAINS is case-SENSITIVE — deliberately unlike the
      // port's `__contains` filter, which lowers both sides.
      const needle = this.propertyOrLabel(stringExp.propertyOrLabelExpression());
      return scalar(`position(${needle.sql} in ${base.sql}) > 0`, "boolean");
    }
    const nullExp = nulls[0];
    if (nullExp !== undefined) {
      const not = nullExp.NOT() !== null ? " NOT" : "";
      // A node/relationship variable's null-ness is its id's null-ness.
      const operand = base.binding === undefined ? base.sql : col(base.binding, "id");
      return scalar(`${operand} IS${not} NULL`, "boolean");
    }
    return base;
  }

  private propertyOrLabel(ctx: PropertyOrLabelExpressionContext): CompiledExpr {
    if (ctx.nodeLabels() !== null) {
      pendingSurface("a label predicate");
    }
    const property = ctx.propertyExpression();
    const names = property.name();
    if (names.length === 0) {
      return this.atom(property.atom());
    }
    if (names.length > 1) {
      pendingSurface("chained property access");
    }
    const symbolCtx = property.atom().symbol();
    if (symbolCtx === null) {
      pendingSurface("property access on a non-variable expression");
    }
    return this.propertyAccess(
      stripBackticks(symbolCtx.getText()),
      stripBackticks(names[0]!.getText()),
    );
  }

  /**
   * `variable.property`, in both forms, from one schema lookup — and the
   * compiler's second line of defence: the validator skips variables it
   * cannot map to a type (a WITH alias), so a property that resolves
   * against no type in the scoped schema is refused here rather than
   * silently nulled, which would leak past the lens.
   */
  private propertyAccess(variable: string, property: string): CompiledExpr {
    const binding = this.state.stage.scope.get(variable);
    if (binding === undefined) {
      reject(unknownVariable(variable, this.state.stage.scope));
    }
    if (binding.kind === "scalar") {
      reject(`'${variable}' is not a node or relationship, so it has no properties.`);
    }
    return this.propertyOf(binding, property);
  }

  /** The same access from a binding already in hand — what an inline
   * property map in a pattern reads its left-hand sides through. */
  propertyOf(binding: TableBinding, property: string): CompiledExpr {
    // System properties are columns of their own, not `props` keys.
    if (property === "_id") {
      // Compared as text: garbage input must be a no-match, never a
      // 22P02 — the OQL analogue of the store's `isUuid` guard.
      return scalar(`${col(binding, "id")}::text`, "string");
    }
    if (property === "_entityTypeKey" || property === "_relationTypeKey") {
      return scalar(col(binding, "type_key"), "string");
    }
    if (property === "_createdAt" || property === "_updatedAt") {
      return scalar(
        col(binding, property === "_createdAt" ? "created_at" : "updated_at"),
        "datetime",
      );
    }

    if (binding.typeKey === null) {
      pendingSurface("property access on an untyped pattern element");
    }
    const definitions = propertiesOf(this.state, binding, binding.typeKey);
    const definition = definitions[property];
    if (definition === undefined) {
      reject(unknownPropertyMessage(binding.kind, binding.typeKey, property, definitions));
    }
    const props = col(binding, "props");
    const key = `'${property}'`;
    return {
      sql: jsonAccessor(definition.dataType, props, key),
      raw: `${props}->${key}`,
      json: () => `${props}->${key}`,
      dataType: definition.dataType,
      isAggregate: false,
    };
  }

  /**
   * `x IN list` — structural jsonb containment, with Cypher's
   * three-valued outcome spelled out: a hit is true, a miss over a list
   * that carries a null (or a null on either side) is null, and only a
   * miss over a null-free list is false.
   */
  private membership(value: CompiledExpr, list: CompiledExpr): CompiledExpr {
    // Both operands are parenthesized: PostgreSQL gives every operator
    // outside its built-in set one flat precedence, so `a @> b->'k'`
    // would associate left into `(a @> b)->'k'`.
    const haystack = `(${list.json()})`;
    const needle = `(${value.json()})`;
    return scalar(
      `CASE WHEN ${haystack} @> ${needle} THEN true` +
        ` WHEN ${needle} IS NULL OR ${haystack} IS NULL` +
        ` OR ${haystack} @> 'null'::jsonb THEN NULL` +
        ` ELSE false END`,
      "boolean",
    );
  }

  private atom(ctx: AtomContext): CompiledExpr {
    const literal = ctx.literal();
    if (literal !== null) {
      const numeric = literal.numLit();
      if (numeric !== null) {
        return this.numericLiteral(numeric.getText());
      }
      const text = literal.stringLit() ?? literal.charLit();
      if (text !== null) {
        const value = unquote(text.getText());
        // The bind is allocated on first read, so a string inside a
        // wholly constant list costs no position of its own — the list
        // folds into one jsonb bind instead.
        const state = this.state;
        let placeholder: string | undefined;
        const bind = (): string => (placeholder ??= state.bindValue(value));
        return {
          get sql() {
            return bind();
          },
          get raw() {
            return bind();
          },
          json: () => `to_jsonb(${bind()}::text)`,
          dataType: "string",
          isAggregate: false,
          constant: { value },
        };
      }
      const bool = literal.boolLit();
      if (bool !== null) {
        const value = bool.getText().toLowerCase() === "true";
        return { ...scalar(String(value), "boolean"), constant: { value } };
      }
      if (literal.NULL_W() !== null) {
        return { ...scalar("NULL", null, () => "NULL"), constant: { value: null } };
      }
      const list = literal.listLit();
      if (list !== null) {
        return this.listLiteral(list);
      }
      return this.mapLiteral(literal.mapLit()!);
    }

    const parameter = ctx.parameter();
    if (parameter !== null) {
      const nameCtx = parameter.symbol() ?? parameter.numLit()!;
      const name = stripBackticks(nameCtx.getText());
      // Which wire shape a parameter needs is only known once a form is
      // read, so each is allocated on first read: a `$list` used only as
      // an `IN` operand takes the jsonb position and no other.
      const state = this.state;
      return {
        get sql() {
          return state.bindParam(name);
        },
        get raw() {
          return state.bindParam(name);
        },
        json: () => `${state.bindParamJson(name)}::jsonb`,
        dataType: null,
        isAggregate: false,
      };
    }

    if (ctx.countAll() !== null) {
      return aggregate("count(*)", "integer", { kind: "number" });
    }

    const invocation = ctx.functionInvocation();
    if (invocation !== null) {
      return this.functionCall(invocation);
    }

    const parenthesized = ctx.parenthesizedExpression();
    if (parenthesized !== null) {
      const inner = this.compile(parenthesized.expression());
      return {
        ...inner,
        sql: `(${inner.sql})`,
        raw: `(${inner.raw})`,
        json: () => `(${inner.json()})`,
      };
    }

    const symbol = ctx.symbol();
    if (symbol !== null) {
      return this.symbolAtom(stripBackticks(symbol.getText()));
    }

    pendingSurface(`the expression '${ctx.getText()}'`);
  }

  /** The disambiguation step: scope, then numeric content, then refuse. */
  private symbolAtom(text: string): CompiledExpr {
    const binding = this.state.stage.scope.get(text);
    if (binding !== undefined) {
      if (binding.kind === "scalar") {
        return { ...scalar(binding.sqlExpr, binding.dataType), conversion: binding.conversion };
      }
      return {
        sql: col(binding, "id"),
        raw: projectedObject(binding),
        json: () => projectedObject(binding),
        dataType: null,
        binding,
        isAggregate: false,
      };
    }
    const numeric = numericSql(text);
    if (numeric !== null) {
      return numberExpr(numeric);
    }
    reject(unknownVariable(text, this.state.stage.scope));
  }

  private numericLiteral(text: string): CompiledExpr {
    const numeric = numericSql(text);
    if (numeric === null) {
      pendingSurface(`the numeric literal '${text}'`);
    }
    return numberExpr(numeric);
  }

  /** `[…]` — one jsonb bind when every element is constant, a composed
   * `jsonb_build_array` when one is not. */
  private listLiteral(ctx: ListLitContext): CompiledExpr {
    const elements = (ctx.expressionChain()?.expression() ?? []).map((element) =>
      this.compile(element),
    );
    const constants = elements.map((element) => element.constant);
    if (constants.every((entry) => entry !== undefined)) {
      const value = constants.map((entry) => entry!.value);
      return this.jsonConstant(value);
    }
    return jsonExpr(
      `jsonb_build_array(${elements.map((element) => element.json()).join(", ")})`,
    );
  }

  /** `{…}` — the map mirror of `listLiteral`. */
  private mapLiteral(ctx: MapLitContext): CompiledExpr {
    const pairs = ctx.mapPair().map((pair) => ({
      key: stripBackticks(pair.name().getText()),
      value: this.compile(pair.expression()),
    }));
    if (pairs.every((pair) => pair.value.constant !== undefined)) {
      const value: Record<string, unknown> = {};
      for (const pair of pairs) {
        value[pair.key] = pair.value.constant!.value;
      }
      return this.jsonConstant(value);
    }
    const arguments_ = pairs.flatMap((pair) => [quoteLiteral(pair.key), pair.value.json()]);
    return jsonExpr(`jsonb_build_object(${arguments_.join(", ")})`);
  }

  /** A wholly constant list or map: one jsonb bind, JSON encoded here. */
  private jsonConstant(value: unknown): CompiledExpr {
    const placeholder = `${this.state.bindValue(JSON.stringify(value))}::jsonb`;
    return { ...jsonExpr(placeholder), constant: { value } };
  }

  /** The seven aggregates. Cypher's empty-group answers differ from
   * SQL's for two of them, and both bends are spelled out here: `sum`
   * yields 0 rather than NULL, `collect` yields `[]` rather than NULL —
   * and `collect` drops nulls, which SQL's `jsonb_agg` does not. */
  private functionCall(ctx: FunctionInvocationContext): CompiledExpr {
    const name = ctx
      .invocationName()
      .symbol_()
      .map((part) => stripBackticks(part.getText()))
      .join(".")
      .toLowerCase();
    const args = ctx.expressionChain()?.expression() ?? [];
    if (args.length !== 1) {
      pendingSurface(`${name}() with anything but one argument`);
    }
    const argument = this.compile(args[0]!);
    // A node or relationship is non-null exactly when its id is.
    const presence = argument.binding === undefined ? argument.sql : col(argument.binding, "id");
    switch (name) {
      case "count":
        return aggregate(`count(${presence})`, "integer", { kind: "number" });
      case "sum":
        return aggregate(`COALESCE(sum(${argument.sql}), 0)`, argument.dataType, {
          kind: "number",
        });
      case "avg":
        return aggregate(`avg(${argument.sql})`, argument.dataType, { kind: "number" });
      case "min":
      case "max":
        return aggregate(
          `${name}(${argument.sql})`,
          argument.dataType,
          aggregateConversion(argument.dataType),
        );
      case "collect":
        // The projection form is what is collected, so a collected value
        // is byte-identical to the same value projected on its own.
        return aggregate(
          `COALESCE(jsonb_agg(${argument.raw}) FILTER (WHERE ${presence} IS NOT NULL), '[]'::jsonb)`,
          argument.dataType,
          argument.binding === undefined
            ? scalarConversion(argument.dataType)
            : objectConversion(this.state.schema, argument.binding),
        );
      default:
        pendingSurface(`the ${name}() aggregate`);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Combine boolean operands, parenthesizing the chain as a whole — the
 * precedence tree is already nested, so operands need no parentheses of
 * their own and the result composes safely into any enclosing AND. */
function chain(operands: CompiledExpr[], operator: string): CompiledExpr {
  if (operands.length === 1) {
    return operands[0]!;
  }
  return scalar(`(${operands.map((operand) => operand.sql).join(` ${operator} `)})`, "boolean");
}

/** An expression that is jsonb in every position — a list or map. */
function jsonExpr(sql: string): CompiledExpr {
  return { sql, raw: sql, json: () => sql, dataType: null, isAggregate: false };
}

/** An aggregate column, with the conversion `pg`'s wire types demand. */
function aggregate(
  sql: string,
  dataType: string | null,
  conversion: ColumnConversion,
): CompiledExpr {
  return { sql, raw: sql, json: () => sql, dataType, isAggregate: true, conversion };
}

/** A SQL string literal — used only for map keys, which are schema-shaped
 * identifiers, never values. */
function quoteLiteral(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

function propertiesOf(
  state: CompileState,
  binding: Binding & { kind: "entity" | "relation" },
  typeKey: string,
): Record<string, PropertyDef> {
  const definition =
    binding.kind === "entity"
      ? state.schema.entityTypes[typeKey]
      : state.schema.relationTypes[typeKey];
  return definition?.properties ?? {};
}

function unknownVariable(variable: string, scope: ReadonlyMap<string, Binding>): string {
  return `Unknown variable '${variable}'. Available: ${[...scope.keys()].sort().join(", ")}`;
}

/** A numeric literal, inlined into the SQL (it carries no user text) and
 * known at compile time, so a constant list can fold around it. */
function numberExpr(numeric: { sql: string; dataType: string }): CompiledExpr {
  return { ...scalar(numeric.sql, numeric.dataType), constant: { value: Number(numeric.sql) } };
}

/** Cypher's integer and float literal forms → a bare SQL numeric. */
function numericSql(text: string): { sql: string; dataType: string } | null {
  const clean = text.replaceAll("_", "");
  const negative = clean.startsWith("-");
  const sign = negative ? "-" : "";
  const body = negative ? clean.slice(1) : clean;
  if (/^0[xX][0-9a-fA-F]+$/.test(body) || /^0[oO][0-7]+$/.test(body)) {
    return { sql: `${sign}${BigInt(body.toLowerCase())}`, dataType: "integer" };
  }
  if (/^[0-9]+$/.test(body)) {
    return { sql: `${sign}${BigInt(body)}`, dataType: "integer" };
  }
  if (/^([0-9]+\.[0-9]*|\.[0-9]+|[0-9]+)([eE][+-]?[0-9]+)?[fd]?$/.test(body)) {
    return { sql: `${sign}${Number(body.replace(/[fd]$/, ""))}`, dataType: "float" };
  }
  return null;
}

/** A quoted OQL string literal → its value (the bind, never the SQL). */
function unquote(text: string): string {
  return text.slice(1, -1).replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_match, escape: string) => {
    if (escape.startsWith("u")) {
      return String.fromCharCode(Number.parseInt(escape.slice(1), 16));
    }
    switch (escape) {
      case "b":
        return "\b";
      case "t":
        return "\t";
      case "n":
        return "\n";
      case "f":
        return "\f";
      case "r":
        return "\r";
      default:
        return escape;
    }
  });
}
