"""Compile validated OQL to Neo4j Cypher.

OQL queries are written in ontology type keys. This adapter's dialect uses
PascalCase node labels and UPPER_SNAKE_CASE relationship types, so the
compiler rewrites the type-key tokens accordingly; everything else in the
query text passes through unchanged (OQL syntax is openCypher-shaped).
"""

from antlr4.TokenStreamRewriter import TokenStreamRewriter

from ontoforge_server.core import oql
from ontoforge_server.core.oql import ValidatedQuery


def _to_pascal_case(key: str) -> str:
    return "".join(segment.capitalize() for segment in key.split("_"))


def _to_upper_snake_case(key: str) -> str:
    return key.upper()


def compile_query(validated: ValidatedQuery) -> str:
    """Return the Cypher text for a validated OQL query."""
    rewriter = TokenStreamRewriter(validated.token_stream)
    for lt in validated.analysis.label_tokens:
        if lt.is_relationship:
            new = _to_upper_snake_case(lt.text)
        else:
            new = _to_pascal_case(lt.text)
        if new != lt.text:
            rewriter.replaceSingleToken(
                validated.token_stream.tokens[lt.token_index], new
            )
    return rewriter.getDefaultText()


def validate_and_compile(query: str, schema) -> str:
    """Convenience: parse + validate OQL, then compile to Cypher."""
    return compile_query(oql.parse_and_validate(query, schema))
