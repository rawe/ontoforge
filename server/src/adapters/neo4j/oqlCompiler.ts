/**
 * Compile validated OQL to Neo4j Cypher.
 *
 * OQL queries are written in lens type keys. This adapter's dialect
 * uses PascalCase node labels and UPPER_SNAKE_CASE relationship types, so
 * the compiler rewrites the type-key tokens accordingly — through the
 * token positions the analysis provides, never by textual find-replace
 * (`docs/storage-adapters.md#the-validated-query`). Everything else in
 * the query text passes through unchanged (OQL syntax is
 * openCypher-shaped).
 */

import { TokenStreamRewriter } from "antlr4ng";

import { parseAndValidate, type ValidatedQuery } from "../../core/oql/index.js";
import { toPascalCase, toUpperSnakeCase } from "./ddl.js";

/** Return the Cypher text for a validated OQL query. */
export function compileQuery(validated: ValidatedQuery): string {
  const rewriter = new TokenStreamRewriter(validated.tokenStream);
  for (const lt of validated.analysis.labelTokens) {
    const rewritten = lt.isRelationship ? toUpperSnakeCase(lt.text) : toPascalCase(lt.text);
    if (rewritten !== lt.text) {
      rewriter.replaceSingle(validated.tokenStream.get(lt.tokenIndex), rewritten);
    }
  }
  return rewriter.getText();
}

/** Convenience: parse + validate OQL, then compile to Cypher. */
export function validateAndCompile(query: string, schema: ValidatedQuery["schema"]): string {
  return compileQuery(parseAndValidate(query, schema));
}
