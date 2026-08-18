/**
 * OQL — OntoForge Query Language: parsing and validation.
 *
 * OQL is OntoForge's read-only graph query language over ontology type
 * keys. Its syntax is openCypher-shaped; its normative reference is the
 * ISO GQL standard (ISO/IEC 39075:2024) and the GPML pattern sublanguage
 * shared with SQL/PGQ — see `docs/decisions.md#behaviour`.
 *
 * This module is database-independent: it parses user-submitted OQL with
 * the ANTLR parser generated from the vendored Cypher grammar
 * (`grammar/*.g4`, `npm run generate:oql`), validates entity/relation
 * type keys and properties against the scoped ontology schema, and
 * enforces the closed OQL surface fail-closed: write operations, CALL,
 * and every construct or function the grammar parses but the enumeration
 * in `docs/capabilities/oql.md` ("Supported surface") does not name are
 * rejected at validation, identically on every backend. The result of
 * `parseAndValidate` is a `ValidatedQuery` that a database adapter
 * compiles to its native dialect (e.g. `adapters/neo4j/oqlCompiler.ts`).
 *
 * Every rejection carries self-correction hints naming the valid
 * candidates — contractual, not incidental: the primary caller composing
 * OQL is a language model, and the hint list lets its next attempt be
 * correct (`docs/capabilities/oql.md#self-correction-hints`).
 */

import {
  BaseErrorListener,
  CharStream,
  CommonTokenStream,
  ParseTreeWalker,
  type ATNSimulator,
  type RecognitionException,
  type Recognizer,
  type Token,
} from "antlr4ng";

import { ValidationError } from "../exceptions.js";
import type { SchemaCacheValue } from "../../runtime/schemaCache.js";
import { CypherLexer } from "./generated/CypherLexer.js";
import {
  CypherParser,
  type AddSubExpressionContext,
  type ExpressionContext,
  type FunctionInvocationContext,
  type InvocationNameContext,
  type LimitStContext,
  type MultDivExpressionContext,
  type NodePatternContext,
  type OrderItemContext,
  type PatternPartContext,
  type PowerExpressionContext,
  type ProjectionBodyContext,
  type PropertiesContext,
  type ProjectionItemContext,
  type ProjectionItemsContext,
  type PropertyExpressionContext,
  type RelationDetailContext,
  type ScriptContext,
  type SkipStContext,
  type StringExpPrefixContext,
  type XorExpressionContext,
} from "./generated/CypherParser.js";
import { CypherParserListener } from "./generated/CypherParserListener.js";

/** System properties allowed on all entities / relations. */
export const SYSTEM_PROPERTIES: ReadonlySet<string> = new Set([
  "_id",
  "_entityTypeKey",
  "_relationTypeKey",
  "_createdAt",
  "_updatedAt",
]);

/** Internal labels that must not appear in user queries. */
const INTERNAL_LABELS: ReadonlySet<string> = new Set(["_Entity", "_Chunk"]);

/** Internal relationship types that must not appear in user queries. */
const INTERNAL_REL_TYPES: ReadonlySet<string> = new Set(["_HAS_CHUNK"]);

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------

/** A label or relationship type token found in the query. */
export interface LabelToken {
  tokenIndex: number;
  text: string;
  isRelationship: boolean;
}

/** A property access (variable.property) found in the query. */
export interface PropertyAccess {
  variable: string;
  propertyName: string;
}

/** An inline property map found in a pattern, keyed to its owning type. */
export interface InlineMap {
  /** Label / relationship type written on the owning pattern, or null when
   * the owner carries none (untyped owner — rejected at validation). */
  ownerTypeKey: string | null;
  isRelationship: boolean;
  keys: string[];
}

/** Collected information from walking the parse tree. */
export interface Analysis {
  nodeVariables: Map<string, Set<string>>;
  relVariables: Map<string, string>;
  propertyAccesses: PropertyAccess[];
  labelTokens: LabelToken[];
  writeClauses: string[];
  hasCall: boolean;
  allLabels: Set<string>;
  allRelTypes: Set<string>;
  unlabeledVars: Set<string>;
  /** Identifiers of out-of-surface constructs encountered (fail-closed). */
  unsupported: Set<string>;
  /** Every function invocation name, verbatim (allowlist-checked). */
  functionCalls: Set<string>;
  /** Inline property maps in patterns, lens-checked against their owner. */
  inlineMaps: InlineMap[];
  /** Bare variables used as ORDER BY sort keys (checked against the
   * node/relationship variables in `validate()`). */
  orderBySymbols: string[];
}

/** True if any node variable appears without a label and is never bound
 * to a label elsewhere in the query. */
export function hasLabellessNodes(analysis: Analysis): boolean {
  for (const variable of analysis.unlabeledVars) {
    if (!analysis.nodeVariables.has(variable)) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// ANTLR error listener
// ---------------------------------------------------------------------------

class SyntaxErrorListener extends BaseErrorListener {
  readonly errors: string[] = [];

  override syntaxError<S extends Token, T extends ATNSimulator>(
    _recognizer: Recognizer<T>,
    _offendingSymbol: S | null,
    line: number,
    column: number,
    msg: string,
    _e: RecognitionException | null,
  ): void {
    this.errors.push(`line ${line}:${column} ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Parse-tree listener (collects labels, types, properties, write clauses)
// ---------------------------------------------------------------------------

class Collector extends CypherParserListener {
  readonly analysis: Analysis = {
    nodeVariables: new Map(),
    relVariables: new Map(),
    propertyAccesses: [],
    labelTokens: [],
    writeClauses: [],
    hasCall: false,
    allLabels: new Set(),
    allRelTypes: new Set(),
    unlabeledVars: new Set(),
    unsupported: new Set(),
    functionCalls: new Set(),
    inlineMaps: [],
    orderBySymbols: [],
  };

  /** Nesting depth of aggregate function invocations (nested-aggregate check). */
  private aggregateDepth = 0;

  /** Every variable or alias bound so far, in walk (document) order —
   * consulted when a `RETURN *` / `WITH *` is encountered. */
  private readonly scopeVariables = new Set<string>();

  // -- write clauses --

  override enterCreateSt = (): void => {
    this.analysis.writeClauses.push("CREATE");
  };

  override enterDeleteSt = (): void => {
    this.analysis.writeClauses.push("DELETE");
  };

  override enterSetSt = (): void => {
    this.analysis.writeClauses.push("SET");
  };

  override enterMergeSt = (): void => {
    this.analysis.writeClauses.push("MERGE");
  };

  override enterRemoveSt = (): void => {
    this.analysis.writeClauses.push("REMOVE");
  };

  // -- CALL --

  override enterStandaloneCall = (): void => {
    this.analysis.hasCall = true;
  };

  override enterQueryCallSt = (): void => {
    this.analysis.hasCall = true;
  };

  // -- node labels --

  override enterNodePattern = (ctx: NodePatternContext): void => {
    const symbolCtx = ctx.symbol();
    const variable = symbolCtx === null ? null : stripBackticks(symbolCtx.getText());
    if (variable !== null) {
      this.scopeVariables.add(variable);
    }

    const labelsCtx = ctx.nodeLabels();
    const labelNames = labelsCtx === null ? [] : labelsCtx.name();
    if (labelNames.length > 1) {
      this.analysis.unsupported.add("multi-label");
    }
    if (labelNames.length > 0) {
      for (const nameCtx of labelNames) {
        const label = stripBackticks(nameCtx.getText());
        this.analysis.allLabels.add(label);
        this.analysis.labelTokens.push({
          tokenIndex: nameCtx.start!.tokenIndex,
          text: label,
          isRelationship: false,
        });
        if (variable !== null) {
          let labels = this.analysis.nodeVariables.get(variable);
          if (labels === undefined) {
            labels = new Set();
            this.analysis.nodeVariables.set(variable, labels);
          }
          labels.add(label);
        }
      }
    } else if (variable !== null) {
      // Node with variable but no label — only flag if this variable
      // hasn't been bound to a label elsewhere (re-reference is OK).
      this.analysis.unlabeledVars.add(variable);
    }

    this.collectInlineMap(
      ctx.properties(),
      labelNames.length > 0 ? stripBackticks(labelNames[0]!.getText()) : null,
      false,
    );
  };

  // -- relationship types --

  override enterRelationDetail = (ctx: RelationDetailContext): void => {
    const symbolCtx = ctx.symbol();
    const variable = symbolCtx === null ? null : stripBackticks(symbolCtx.getText());
    if (variable !== null) {
      this.scopeVariables.add(variable);
    }

    const typesCtx = ctx.relationshipTypes();
    const typeNames = typesCtx === null ? [] : typesCtx.name();
    if (typeNames.length > 1) {
      this.analysis.unsupported.add("rel-type-union");
    }
    for (const nameCtx of typeNames) {
      const relType = stripBackticks(nameCtx.getText());
      this.analysis.allRelTypes.add(relType);
      this.analysis.labelTokens.push({
        tokenIndex: nameCtx.start!.tokenIndex,
        text: relType,
        isRelationship: true,
      });
      if (variable !== null) {
        this.analysis.relVariables.set(variable, relType);
      }
    }

    this.collectInlineMap(
      ctx.properties(),
      typeNames.length > 0 ? stripBackticks(typeNames[0]!.getText()) : null,
      true,
    );
  };

  /** Record the keys of an inline property map against its owning type. */
  private collectInlineMap(
    propertiesCtx: PropertiesContext | null,
    ownerTypeKey: string | null,
    isRelationship: boolean,
  ): void {
    const mapCtx = propertiesCtx?.mapLit() ?? null;
    if (mapCtx === null) {
      return;
    }
    this.analysis.inlineMaps.push({
      ownerTypeKey,
      isRelationship,
      keys: mapCtx.mapPair().map((pair) => stripBackticks(pair.name().getText())),
    });
  }

  // -- property access (variable.property) --

  override enterPropertyExpression = (ctx: PropertyExpressionContext): void => {
    const names = ctx.name();
    if (names.length === 0) {
      return;
    }
    if (names.length > 1) {
      // `p.a.b` — chained access; rejected as a whole, not attributed to `p`.
      this.analysis.unsupported.add("chained-property");
      return;
    }
    this.analysis.propertyAccesses.push({
      variable: stripBackticks(ctx.atom().getText()),
      propertyName: stripBackticks(names[0]!.getText()),
    });
  };

  // -- out-of-surface constructs (fail-closed enumeration) --

  override enterRangeLit = (): void => {
    this.analysis.unsupported.add("variable-length");
  };

  override enterUnionSt = (): void => {
    this.analysis.unsupported.add("union");
  };

  override enterUnwindSt = (): void => {
    this.analysis.unsupported.add("unwind");
  };

  override enterCaseExpression = (): void => {
    this.analysis.unsupported.add("case");
  };

  override enterListComprehension = (): void => {
    this.analysis.unsupported.add("comprehension");
  };

  override enterPatternComprehension = (): void => {
    this.analysis.unsupported.add("comprehension");
  };

  override enterFilterWith = (): void => {
    this.analysis.unsupported.add("quantifier");
  };

  override enterSubqueryExist = (): void => {
    this.analysis.unsupported.add("exists");
  };

  override enterPatternPart = (ctx: PatternPartContext): void => {
    if (ctx.symbol() !== null) {
      this.analysis.unsupported.add("named-path");
    }
  };

  override enterXorExpression = (ctx: XorExpressionContext): void => {
    // The rule sits in the precedence chain and fires for every
    // expression; only ≥2 operands mean an actual XOR.
    if (ctx.andExpression().length > 1) {
      this.analysis.unsupported.add("xor");
    }
  };

  override enterAddSubExpression = (ctx: AddSubExpressionContext): void => {
    if (ctx.multDivExpression().length > 1) {
      this.analysis.unsupported.add("arithmetic");
    }
  };

  override enterMultDivExpression = (ctx: MultDivExpressionContext): void => {
    if (ctx.powerExpression().length > 1) {
      this.analysis.unsupported.add("arithmetic");
    }
  };

  override enterPowerExpression = (ctx: PowerExpressionContext): void => {
    if (ctx.unaryAddSubExpression().length > 1) {
      this.analysis.unsupported.add("arithmetic");
    }
  };

  override enterStringExpPrefix = (ctx: StringExpPrefixContext): void => {
    if (ctx.STARTS() !== null || ctx.ENDS() !== null) {
      this.analysis.unsupported.add("starts-ends-with");
    }
  };

  // -- DISTINCT (both positions: projection and function call) --

  override enterProjectionBody = (ctx: ProjectionBodyContext): void => {
    if (ctx.DISTINCT() !== null) {
      this.analysis.unsupported.add("distinct");
    }
  };

  // -- functions (allowlist names, nested aggregates) --

  override enterFunctionInvocation = (ctx: FunctionInvocationContext): void => {
    if (ctx.DISTINCT() !== null) {
      this.analysis.unsupported.add("distinct");
    }
    if (isAggregate(invocationNameText(ctx))) {
      if (this.aggregateDepth > 0) {
        this.analysis.unsupported.add("nested-aggregate");
      }
      this.aggregateDepth += 1;
    }
  };

  override exitFunctionInvocation = (ctx: FunctionInvocationContext): void => {
    if (isAggregate(invocationNameText(ctx))) {
      this.aggregateDepth -= 1;
    }
  };

  override enterCountAll = (): void => {
    if (this.aggregateDepth > 0) {
      this.analysis.unsupported.add("nested-aggregate");
    }
  };

  override enterInvocationName = (ctx: InvocationNameContext): void => {
    this.analysis.functionCalls.add(
      ctx
        .symbol_()
        .map((part) => stripBackticks(part.getText()))
        .join("."),
    );
  };

  // -- projections: aliases, `RETURN *` / `WITH *` scope check --

  override enterProjectionItem = (ctx: ProjectionItemContext): void => {
    const aliasCtx = ctx.symbol();
    if (aliasCtx !== null) {
      this.scopeVariables.add(stripBackticks(aliasCtx.getText()));
    }
  };

  override enterProjectionItems = (ctx: ProjectionItemsContext): void => {
    if (ctx.MULT() !== null && this.scopeVariables.size === 0) {
      this.analysis.unsupported.add("star-without-scope");
    }
  };

  // -- ORDER BY sort keys, SKIP/LIMIT operands --

  override enterOrderItem = (ctx: OrderItemContext): void => {
    const shape = classifyExpression(ctx.expression());
    if (shape.kind === "variable") {
      this.analysis.orderBySymbols.push(shape.name);
    } else if (shape.kind === "constant" || shape.kind === "parameter") {
      this.analysis.unsupported.add("order-by-constant");
    }
  };

  override enterSkipSt = (ctx: SkipStContext): void => {
    this.checkSkipLimitOperand(ctx.expression());
  };

  override enterLimitSt = (ctx: LimitStContext): void => {
    this.checkSkipLimitOperand(ctx.expression());
  };

  private checkSkipLimitOperand(ctx: ExpressionContext): void {
    const shape = classifyExpression(ctx);
    const ok =
      shape.kind === "parameter" ||
      (shape.kind === "constant" && /^[0-9]+$/.test(shape.text));
    if (!ok) {
      this.analysis.unsupported.add("skip-limit");
    }
  }
}

/** The allowlisted aggregate function names (case-insensitive). */
const FUNCTION_ALLOWLIST: ReadonlySet<string> = new Set([
  "count",
  "sum",
  "avg",
  "min",
  "max",
  "collect",
]);

function isAggregate(name: string): boolean {
  return FUNCTION_ALLOWLIST.has(name.toLowerCase());
}

function invocationNameText(ctx: FunctionInvocationContext): string {
  return ctx
    .invocationName()
    .symbol_()
    .map((part) => stripBackticks(part.getText()))
    .join(".");
}

/** The shape of a single expression, for sort-key and operand checks. */
type ExpressionShape =
  | { kind: "variable"; name: string }
  | { kind: "constant"; text: string }
  | { kind: "parameter" }
  | { kind: "property" }
  | { kind: "other" };

/**
 * Descend an expression's single-operand precedence chain and classify
 * what sits at the bottom. Any operator on the way down (a second
 * operand, NOT, a unary sign, a string/list/null postfix, a label tail)
 * classifies as "other" — those carry their own rejection rules.
 */
function classifyExpression(ctx: ExpressionContext): ExpressionShape {
  const other: ExpressionShape = { kind: "other" };

  const xorOperands = ctx.xorExpression();
  if (xorOperands.length !== 1) return other;
  const andOperands = xorOperands[0]!.andExpression();
  if (andOperands.length !== 1) return other;
  const notOperands = andOperands[0]!.notExpression();
  if (notOperands.length !== 1) return other;
  const notCtx = notOperands[0]!;
  if (notCtx.NOT().length > 0) return other;
  const addSubOperands = notCtx.comparisonExpression().addSubExpression();
  if (addSubOperands.length !== 1) return other;
  const multDivOperands = addSubOperands[0]!.multDivExpression();
  if (multDivOperands.length !== 1) return other;
  const powerOperands = multDivOperands[0]!.powerExpression();
  if (powerOperands.length !== 1) return other;
  const unaryOperands = powerOperands[0]!.unaryAddSubExpression();
  if (unaryOperands.length !== 1) return other;
  const unaryCtx = unaryOperands[0]!;
  if (unaryCtx.PLUS() !== null || unaryCtx.SUB() !== null) return other;
  const atomicCtx = unaryCtx.atomicExpression();
  if (
    atomicCtx.stringExpression().length > 0 ||
    atomicCtx.listExpression().length > 0 ||
    atomicCtx.nullExpression().length > 0
  ) {
    return other;
  }
  const polCtx = atomicCtx.propertyOrLabelExpression();
  if (polCtx.nodeLabels() !== null) return other;
  const propertyCtx = polCtx.propertyExpression();
  if (propertyCtx.name().length > 0) return { kind: "property" };

  const atom = propertyCtx.atom();
  if (atom.literal() !== null) return { kind: "constant", text: atom.getText() };
  if (atom.parameter() !== null) return { kind: "parameter" };
  const parenCtx = atom.parenthesizedExpression();
  if (parenCtx !== null) return classifyExpression(parenCtx.expression());
  const symbolCtx = atom.symbol();
  if (symbolCtx !== null) {
    const text = stripBackticks(symbolCtx.getText());
    // Positive integers lex as `Integer` and reach the parser as symbols,
    // not literals — a leading digit means a number, never a variable.
    if (/^[0-9]/.test(text)) return { kind: "constant", text };
    return { kind: "variable", name: text };
  }
  return other;
}

/**
 * Construct → rejection message, one row per out-of-surface construct.
 * The OQL surface is a closed enumeration (`docs/capabilities/oql.md`,
 * "Supported surface"); everything here parses but is outside it. Every
 * message is pinned character-for-character by exact-wording tests.
 */
const SURFACE_REJECTIONS: readonly (readonly [string, string])[] = [
  [
    "variable-length",
    "Variable-length relationship patterns are not supported. " +
      "Write each hop as an explicit relationship pattern.",
  ],
  ["union", "UNION is not supported. Run separate queries and combine the results in the caller."],
  ["unwind", "UNWIND is not supported. Match the rows you need directly with MATCH and WHERE."],
  [
    "case",
    "CASE expressions are not supported. Filter with WHERE, or compute the distinction in the caller.",
  ],
  [
    "comprehension",
    "List and pattern comprehensions are not supported. " +
      "Use MATCH with WHERE, and collect(...) to build lists.",
  ],
  [
    "quantifier",
    "Quantified predicates (ALL, ANY, NONE, SINGLE) are not supported. " +
      "Express the condition with MATCH patterns and WHERE.",
  ],
  [
    "exists",
    "EXISTS subqueries are not supported. " +
      "Match the pattern directly, or use OPTIONAL MATCH with IS NOT NULL.",
  ],
  ["named-path", "Named paths are not supported. Bind the nodes and relationships you need with variables."],
  [
    "multi-label",
    "Multi-label node patterns are not supported. A node pattern names exactly one entity type.",
  ],
  [
    "rel-type-union",
    "Relationship-type unions ([:a|b]) are not supported. Match each relationship type separately.",
  ],
  ["map-projection", "Map projections are not supported. Return each property explicitly."],
  ["arithmetic", "Arithmetic expressions are not supported. Compute derived values in the caller."],
  [
    "starts-ends-with",
    "STARTS WITH and ENDS WITH are not supported. Use CONTAINS to match substrings.",
  ],
  ["distinct", "DISTINCT is not supported. Deduplicate in the caller, or aggregate with collect(...)."],
  ["xor", "XOR is not supported. Express the condition with AND, OR and NOT."],
  [
    "nested-aggregate",
    "Aggregate functions cannot be nested. Compute the inner aggregate in a WITH clause first.",
  ],
  [
    "order-by-entity",
    "Cannot order by a node or relationship — order by one of its properties instead.",
  ],
  [
    "order-by-constant",
    "Cannot order by a constant or a parameter — order by a property, an alias, or an aggregate instead.",
  ],
  ["skip-limit", "SKIP/LIMIT take a non-negative integer or a $parameter."],
  [
    "chained-property",
    "Nested property access is not supported — properties hold scalar values.",
  ],
  ["star-without-scope", "RETURN * is not allowed when there are no variables in scope."],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A possibly backtick-quoted identifier → its bare name. Adapter
 * compilers read the same identifiers off the parse tree and must strip
 * them identically. */
export function stripBackticks(name: string): string {
  if (name.startsWith("`") && name.endsWith("`")) {
    return name.slice(1, -1);
  }
  return name;
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

// ---------------------------------------------------------------------------
// Parse → Analyze → Validate pipeline
// ---------------------------------------------------------------------------

/** Lex + parse an OQL string. Throws `ValidationError` on syntax errors. */
export function parse(query: string): { tokenStream: CommonTokenStream; tree: ScriptContext } {
  const inputStream = CharStream.fromString(query);
  const lexer = new CypherLexer(inputStream);
  lexer.removeErrorListeners();
  const err = new SyntaxErrorListener();
  lexer.addErrorListener(err);

  const tokenStream = new CommonTokenStream(lexer);
  const parser = new CypherParser(tokenStream);
  parser.removeErrorListeners();
  parser.addErrorListener(err);

  const tree = parser.script();

  if (err.errors.length > 0) {
    throw new ValidationError("Invalid query syntax: " + err.errors.join("; "));
  }
  return { tokenStream, tree };
}

export function analyze(tree: ScriptContext): Analysis {
  const collector = new Collector();
  ParseTreeWalker.DEFAULT.walk(collector, tree);
  return collector.analysis;
}

/**
 * Return a list of human-readable validation errors (empty = OK).
 *
 * Error messages include hints about available types and properties so
 * that LLMs (and humans) can self-correct their queries.
 */
export function validate(analysis: Analysis, schema: SchemaCacheValue): string[] {
  const errors: string[] = [];

  // 1. Write clauses
  if (analysis.writeClauses.length > 0) {
    const clauses = sorted(new Set(analysis.writeClauses)).join(", ");
    errors.push(
      `Write operations are not allowed: ${clauses}. ` +
        "Only read queries are supported (MATCH, WHERE, RETURN, " +
        "ORDER BY, LIMIT, SKIP, OPTIONAL MATCH, WITH).",
    );
  }

  // 2. CALL / procedures
  if (analysis.hasCall) {
    errors.push("CALL procedures are not allowed. Use MATCH patterns to query data.");
  }

  // 3. Out-of-surface constructs (the closed surface, fail-closed), then
  //    the function allowlist.
  const violations = new Set(analysis.unsupported);
  for (const name of analysis.orderBySymbols) {
    if (
      analysis.nodeVariables.has(name) ||
      analysis.unlabeledVars.has(name) ||
      analysis.relVariables.has(name)
    ) {
      violations.add("order-by-entity");
    }
  }
  for (const [construct, message] of SURFACE_REJECTIONS) {
    if (violations.has(construct)) {
      errors.push(message);
    }
  }
  for (const name of sorted(analysis.functionCalls)) {
    const lower = name.toLowerCase();
    if (lower === "reduce") {
      errors.push(
        "REDUCE is not supported. Aggregate with the supported functions: " +
          "avg, collect, count, max, min, sum.",
      );
    } else if (!FUNCTION_ALLOWLIST.has(lower)) {
      errors.push(
        `Unknown function: '${name}'. Available functions: avg, collect, count, max, min, sum.`,
      );
    }
  }

  // 4. Labelless nodes (scope leak)
  if (hasLabellessNodes(analysis)) {
    const available = sorted(Object.keys(schema.entityTypes));
    errors.push(
      "All node patterns must specify a label. " +
        `Available entity types: ${available.join(", ")}`,
    );
  }

  // 5. Node labels
  const validEntityKeys = new Set(Object.keys(schema.entityTypes));
  for (const label of sorted(analysis.allLabels)) {
    if (INTERNAL_LABELS.has(label)) {
      errors.push(
        `Internal label '${label}' cannot be queried directly. ` +
          `Use entity type keys: ${sorted(validEntityKeys).join(", ")}`,
      );
    } else if (!validEntityKeys.has(label)) {
      errors.push(
        `Unknown entity type: '${label}'. Available: ${sorted(validEntityKeys).join(", ")}`,
      );
    }
  }

  // 6. Relationship types
  const validRelKeys = new Set(Object.keys(schema.relationTypes));
  for (const relType of sorted(analysis.allRelTypes)) {
    if (INTERNAL_REL_TYPES.has(relType)) {
      errors.push(
        `Internal relationship type '${relType}' cannot be queried ` +
          `directly. Use relation type keys: ${sorted(validRelKeys).join(", ")}`,
      );
    } else if (!validRelKeys.has(relType)) {
      errors.push(
        `Unknown relation type: '${relType}'. Available: ${sorted(validRelKeys).join(", ")}`,
      );
    }
  }

  // 7. Property accesses (pattern-local type inference only)
  const varToEntity = new Map<string, string>();
  for (const [variable, labels] of analysis.nodeVariables) {
    for (const label of labels) {
      if (validEntityKeys.has(label)) {
        varToEntity.set(variable, label);
        break;
      }
    }
  }

  const varToRel = new Map<string, string>();
  for (const [variable, relType] of analysis.relVariables) {
    if (validRelKeys.has(relType)) {
      varToRel.set(variable, relType);
    }
  }

  for (const pa of analysis.propertyAccesses) {
    if (SYSTEM_PROPERTIES.has(pa.propertyName)) {
      continue;
    }

    const etKey = varToEntity.get(pa.variable);
    const rtKey = varToRel.get(pa.variable);
    if (etKey !== undefined) {
      const etProps = schema.entityTypes[etKey]!.properties;
      if (!(pa.propertyName in etProps)) {
        const available = [...sorted(Object.keys(etProps)), ...sorted(SYSTEM_PROPERTIES)];
        errors.push(
          `Unknown property '${pa.propertyName}' on entity type '${etKey}'. ` +
            `Available: ${available.join(", ")}`,
        );
      }
    } else if (rtKey !== undefined) {
      const rtProps = schema.relationTypes[rtKey]!.properties;
      if (!(pa.propertyName in rtProps)) {
        const available = [...sorted(Object.keys(rtProps)), ...sorted(SYSTEM_PROPERTIES)];
        errors.push(
          `Unknown property '${pa.propertyName}' on relation type '${rtKey}'. ` +
            `Available: ${available.join(", ")}`,
        );
      }
    }
    // Variables not in either map (e.g. WITH aliases) are not validated.
  }

  // 8. Inline property maps — keys resolve against the owning type
  //    directly (label-direct, not via the variable→type map); an owner
  //    with no type in the pattern is rejected outright.
  for (const im of analysis.inlineMaps) {
    if (im.ownerTypeKey === null) {
      errors.push(
        "An inline property map needs a typed owner — add a label to the node " +
          "(or a type to the relationship) so its keys can be validated.",
      );
      continue;
    }
    if (!im.isRelationship) {
      const et = schema.entityTypes[im.ownerTypeKey];
      if (et === undefined) {
        continue; // the label itself was already reported above
      }
      for (const key of im.keys) {
        if (SYSTEM_PROPERTIES.has(key) || key in et.properties) {
          continue;
        }
        const available = [...sorted(Object.keys(et.properties)), ...sorted(SYSTEM_PROPERTIES)];
        errors.push(
          `Unknown property '${key}' on entity type '${im.ownerTypeKey}'. ` +
            `Available: ${available.join(", ")}`,
        );
      }
    } else {
      const rt = schema.relationTypes[im.ownerTypeKey];
      if (rt === undefined) {
        continue; // the relationship type itself was already reported above
      }
      for (const key of im.keys) {
        if (SYSTEM_PROPERTIES.has(key) || key in rt.properties) {
          continue;
        }
        const available = [...sorted(Object.keys(rt.properties)), ...sorted(SYSTEM_PROPERTIES)];
        errors.push(
          `Unknown property '${key}' on relation type '${im.ownerTypeKey}'. ` +
            `Available: ${available.join(", ")}`,
        );
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * A parsed and schema-validated OQL query.
 *
 * Opaque to services; database adapters compile it to their native
 * dialect. The object carries everything a compiler needs: the parse
 * tree, the token stream, the analysis, and the scoped schema the query
 * was validated against.
 */
export interface ValidatedQuery {
  /** The original query text — diagnostics and logging only. An adapter
   * must never compile from it. */
  text: string;
  tokenStream: CommonTokenStream;
  /** The parse tree the analysis was collected from. */
  tree: ScriptContext;
  analysis: Analysis;
  /** The scoped schema the query was validated against. */
  schema: SchemaCacheValue;
}

/**
 * Parse and validate an OQL query against the scoped schema.
 * Throws `ValidationError` if the query is invalid.
 */
export function parseAndValidate(query: string, schema: SchemaCacheValue): ValidatedQuery {
  const { tokenStream, tree } = parse(query);
  const analysis = analyze(tree);
  const errors = validate(analysis, schema);
  if (errors.length > 0) {
    throw new ValidationError("Query validation failed", { errors });
  }
  return { text: query, tokenStream, tree, analysis, schema };
}

/**
 * Map variables used in the query to their schema type key (or null).
 * Used for post-processing results to filter properties per type.
 */
export function getReturnVariables(
  query: string,
  schema: SchemaCacheValue,
): Map<string, string | null> {
  const { tree } = parse(query);
  const analysis = analyze(tree);
  const result = new Map<string, string | null>();
  for (const [variable, labels] of analysis.nodeVariables) {
    result.set(variable, null);
    for (const label of labels) {
      if (label in schema.entityTypes) {
        result.set(variable, label);
        break;
      }
    }
  }
  for (const [variable, relType] of analysis.relVariables) {
    result.set(variable, relType in schema.relationTypes ? relType : null);
  }
  return result;
}
