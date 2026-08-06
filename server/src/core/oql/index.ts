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
 * rejects write operations / CALL. The result of `parseAndValidate` is a
 * `ValidatedQuery` that a database adapter compiles to its native dialect
 * (e.g. `adapters/neo4j/oqlCompiler.ts`).
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
  type NodePatternContext,
  type PropertyExpressionContext,
  type RelationDetailContext,
  type ScriptContext,
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
  };

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

    const labelsCtx = ctx.nodeLabels();
    if (labelsCtx !== null) {
      for (const nameCtx of labelsCtx.name()) {
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
  };

  // -- relationship types --

  override enterRelationDetail = (ctx: RelationDetailContext): void => {
    const symbolCtx = ctx.symbol();
    const variable = symbolCtx === null ? null : stripBackticks(symbolCtx.getText());

    const typesCtx = ctx.relationshipTypes();
    if (typesCtx !== null) {
      for (const nameCtx of typesCtx.name()) {
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
    }
  };

  // -- property access (variable.property) --

  override enterPropertyExpression = (ctx: PropertyExpressionContext): void => {
    const variable = stripBackticks(ctx.atom().getText());
    for (const nameCtx of ctx.name()) {
      this.analysis.propertyAccesses.push({
        variable,
        propertyName: stripBackticks(nameCtx.getText()),
      });
    }
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripBackticks(name: string): string {
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
        "ORDER BY, LIMIT, SKIP, OPTIONAL MATCH, WITH, UNWIND).",
    );
  }

  // 2. CALL / procedures
  if (analysis.hasCall) {
    errors.push("CALL procedures are not allowed. Use MATCH patterns to query data.");
  }

  // 3. Labelless nodes (scope leak)
  if (hasLabellessNodes(analysis)) {
    const available = sorted(Object.keys(schema.entityTypes));
    errors.push(
      "All node patterns must specify a label. " +
        `Available entity types: ${available.join(", ")}`,
    );
  }

  // 4. Node labels
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

  // 5. Relationship types
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

  // 6. Property accesses (pattern-local type inference only)
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

  return errors;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * A parsed and schema-validated OQL query.
 *
 * Opaque to services; database adapters compile it to their native
 * dialect (token stream + analysis carry everything a compiler needs).
 */
export interface ValidatedQuery {
  text: string;
  tokenStream: CommonTokenStream;
  analysis: Analysis;
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
  return { text: query, tokenStream, analysis };
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
