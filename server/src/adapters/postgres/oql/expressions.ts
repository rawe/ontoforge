/**
 * The expression walker.
 *
 * Every expression compiles to **two** forms from one schema lookup:
 *
 * - `sql` — predicate and sort form. Property access carries the
 *   encoding table's cast (`(props->'age')::numeric`).
 * - `raw` — value and projection form. Property access stays raw jsonb
 *   (`props->'age'`): the driver parses it back, numbers stay numbers
 *   because the port caps them at ±2^53, and a `::numeric` projection
 *   would come back from `pg` as a *string*. A node or relationship
 *   variable projects as its full object.
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
  PropertyOrLabelExpressionContext,
  UnaryAddSubExpressionContext,
  XorExpressionContext,
} from "../../../core/oql/generated/CypherParser.js";
import { SYSTEM_PROPERTIES, stripBackticks } from "../../../core/oql/index.js";
import type { PropertyDef } from "../../../core/schemas.js";
import { jsonAccessor } from "../filters.js";
import {
  col,
  projectedObject,
  type Binding,
  type CompileState,
  type TableBinding,
} from "./bindings.js";
import { pendingSurface, reject } from "./rejections.js";

/** A compiled expression in its two forms, plus what the stage machine
 * needs to know about it. */
export interface CompiledExpr {
  /** Predicate / sort form. */
  sql: string;
  /** Value / projection form. */
  raw: string;
  /** The declared data type where one is known; `"count"` marks an
   * aggregate column the driver returns as a string. */
  dataType: string | null;
  /** Set when the expression IS a bare node/relationship variable. */
  binding?: TableBinding;
  isAggregate: boolean;
}

function scalar(sql: string, dataType: string | null): CompiledExpr {
  return { sql, raw: sql, dataType, isAggregate: false };
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
    return scalar(`-${inner.sql}`, inner.dataType);
  }

  private atomic(ctx: AtomicExpressionContext): CompiledExpr {
    const base = this.propertyOrLabel(ctx.propertyOrLabelExpression());
    const strings = ctx.stringExpression();
    const nulls = ctx.nullExpression();
    const lists = ctx.listExpression();
    if (lists.length > 0) {
      pendingSurface("IN and list indexing");
    }
    if (strings.length + nulls.length > 1) {
      pendingSurface("a chained postfix expression");
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
      reject(unknownProperty(binding.kind, binding.typeKey, property, definitions));
    }
    const props = col(binding, "props");
    const key = `'${property}'`;
    return {
      sql: jsonAccessor(definition.dataType, props, key),
      raw: `${props}->${key}`,
      dataType: definition.dataType,
      isAggregate: false,
    };
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
        return scalar(this.state.bindValue(unquote(text.getText())), "string");
      }
      const bool = literal.boolLit();
      if (bool !== null) {
        return scalar(bool.getText().toLowerCase(), "boolean");
      }
      if (literal.NULL_W() !== null) {
        return scalar("NULL", null);
      }
      pendingSurface("list and map literals");
    }

    const parameter = ctx.parameter();
    if (parameter !== null) {
      const nameCtx = parameter.symbol() ?? parameter.numLit()!;
      return scalar(this.state.bindParam(stripBackticks(nameCtx.getText())), null);
    }

    if (ctx.countAll() !== null) {
      return { sql: "count(*)", raw: "count(*)", dataType: "count", isAggregate: true };
    }

    const invocation = ctx.functionInvocation();
    if (invocation !== null) {
      return this.functionCall(invocation);
    }

    const parenthesized = ctx.parenthesizedExpression();
    if (parenthesized !== null) {
      const inner = this.compile(parenthesized.expression());
      return { ...inner, sql: `(${inner.sql})`, raw: `(${inner.raw})` };
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
        return scalar(binding.sqlExpr, binding.dataType);
      }
      return {
        sql: col(binding, "id"),
        raw: projectedObject(binding),
        dataType: null,
        binding,
        isAggregate: false,
      };
    }
    const numeric = numericSql(text);
    if (numeric !== null) {
      return scalar(numeric.sql, numeric.dataType);
    }
    reject(unknownVariable(text, this.state.stage.scope));
  }

  private numericLiteral(text: string): CompiledExpr {
    const numeric = numericSql(text);
    if (numeric === null) {
      pendingSurface(`the numeric literal '${text}'`);
    }
    return scalar(numeric.sql, numeric.dataType);
  }

  private functionCall(ctx: FunctionInvocationContext): CompiledExpr {
    const name = ctx
      .invocationName()
      .symbol_()
      .map((part) => stripBackticks(part.getText()))
      .join(".")
      .toLowerCase();
    if (name !== "count") {
      pendingSurface(`the ${name}() aggregate`);
    }
    const args = ctx.expressionChain()?.expression() ?? [];
    if (args.length !== 1) {
      pendingSurface("count() with anything but one argument");
    }
    const argument = this.compile(args[0]!);
    // `count(x)` counts non-null matches — for a variable that is its id.
    const operand = argument.binding === undefined ? argument.sql : col(argument.binding, "id");
    const sql = `count(${operand})`;
    return { sql, raw: sql, dataType: "count", isAggregate: true };
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

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

function unknownVariable(variable: string, scope: ReadonlyMap<string, Binding>): string {
  return `Unknown variable '${variable}'. Available: ${sorted(scope.keys()).join(", ")}`;
}

function unknownProperty(
  kind: "entity" | "relation",
  typeKey: string,
  property: string,
  definitions: Record<string, PropertyDef>,
): string {
  const available = [...sorted(Object.keys(definitions)), ...sorted(SYSTEM_PROPERTIES)];
  return (
    `Unknown property '${property}' on ${kind} type '${typeKey}'. ` +
    `Available: ${available.join(", ")}`
  );
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
