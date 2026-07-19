"""OQL — OntoForge Query Language: parsing and validation.

OQL is OntoForge's read-only graph query language over ontology type keys.
Its syntax is openCypher-shaped; its normative reference is the ISO GQL
standard (ISO/IEC 39075:2024) and the GPML pattern sublanguage shared with
SQL/PGQ — see decision 009 in ``docs/decisions.md``.

This package is database-independent: it parses user-submitted OQL with
antlr4-cypher, validates entity/relation type keys and properties against
the scoped ontology schema, and rejects write operations / CALL. The
result of ``parse_and_validate`` is a ``ValidatedQuery`` that a database
adapter compiles to its native dialect (e.g.
``adapters.neo4j.oql_compiler``).
"""

from __future__ import annotations

import dataclasses
from typing import TYPE_CHECKING

from antlr4 import CommonTokenStream, InputStream, ParseTreeWalker
from antlr4.error.ErrorListener import ErrorListener
from antlr4_cypher import (
    CypherLexer,
    CypherParser,
    CypherParserListener,
)

from ontoforge_server.core.exceptions import ValidationError

if TYPE_CHECKING:
    from ontoforge_server.runtime.service import SchemaCache

# System properties allowed on all entities / relations.
SYSTEM_PROPERTIES = frozenset(
    {"_id", "_entityTypeKey", "_relationTypeKey", "_createdAt", "_updatedAt"}
)

# Internal labels that must not appear in user queries.
_INTERNAL_LABELS = frozenset({"_Entity", "_Chunk"})

# Internal relationship types that must not appear in user queries.
_INTERNAL_REL_TYPES = frozenset({"_HAS_CHUNK"})


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------


@dataclasses.dataclass
class _LabelToken:
    """A label or relationship type token found in the query."""

    token_index: int
    text: str
    is_relationship: bool


@dataclasses.dataclass
class _PropertyAccess:
    """A property access (variable.property) found in the query."""

    variable: str
    property_name: str


@dataclasses.dataclass
class _Analysis:
    """Collected information from walking the parse tree."""

    node_variables: dict[str, set[str]] = dataclasses.field(default_factory=dict)
    rel_variables: dict[str, str] = dataclasses.field(default_factory=dict)
    property_accesses: list[_PropertyAccess] = dataclasses.field(default_factory=list)
    label_tokens: list[_LabelToken] = dataclasses.field(default_factory=list)
    write_clauses: list[str] = dataclasses.field(default_factory=list)
    has_call: bool = False
    all_labels: set[str] = dataclasses.field(default_factory=set)
    all_rel_types: set[str] = dataclasses.field(default_factory=set)
    _unlabeled_vars: set[str] = dataclasses.field(default_factory=set)

    @property
    def has_labelless_nodes(self) -> bool:
        """True if any node variable appears without a label and is never
        bound to a label elsewhere in the query."""
        return bool(self._unlabeled_vars - set(self.node_variables))


# ---------------------------------------------------------------------------
# ANTLR error listener
# ---------------------------------------------------------------------------


class _SyntaxErrorListener(ErrorListener):
    def __init__(self) -> None:
        self.errors: list[str] = []

    def syntaxError(  # noqa: N802
        self, recognizer, offendingSymbol, line, column, msg, e
    ) -> None:
        self.errors.append(f"line {line}:{column} {msg}")


# ---------------------------------------------------------------------------
# Parse-tree listener (collects labels, types, properties, write clauses)
# ---------------------------------------------------------------------------


class _Collector(CypherParserListener):
    def __init__(self) -> None:
        self.analysis = _Analysis()

    # -- write clauses --

    def enterCreateSt(self, ctx) -> None:
        self.analysis.write_clauses.append("CREATE")

    def enterDeleteSt(self, ctx) -> None:
        self.analysis.write_clauses.append("DELETE")

    def enterSetSt(self, ctx) -> None:
        self.analysis.write_clauses.append("SET")

    def enterMergeSt(self, ctx) -> None:
        self.analysis.write_clauses.append("MERGE")

    def enterRemoveSt(self, ctx) -> None:
        self.analysis.write_clauses.append("REMOVE")

    # -- CALL --

    def enterStandaloneCall(self, ctx) -> None:
        self.analysis.has_call = True

    def enterQueryCallSt(self, ctx) -> None:
        self.analysis.has_call = True

    # -- node labels --

    def enterNodePattern(self, ctx) -> None:
        variable = None
        if ctx.symbol():
            variable = _strip_backticks(ctx.symbol().getText())

        labels_ctx = ctx.nodeLabels()
        if labels_ctx:
            names = labels_ctx.name()
            if names:
                for name_ctx in names:
                    label = _strip_backticks(name_ctx.getText())
                    self.analysis.all_labels.add(label)
                    self.analysis.label_tokens.append(
                        _LabelToken(
                            token_index=name_ctx.start.tokenIndex,
                            text=label,
                            is_relationship=False,
                        )
                    )
                    if variable:
                        self.analysis.node_variables.setdefault(
                            variable, set()
                        ).add(label)
        elif variable:
            # Node with variable but no label — only flag if this variable
            # hasn't been bound to a label elsewhere (re-reference is OK).
            self.analysis._unlabeled_vars.add(variable)

    # -- relationship types --

    def enterRelationDetail(self, ctx) -> None:
        variable = None
        if ctx.symbol():
            variable = _strip_backticks(ctx.symbol().getText())

        types_ctx = ctx.relationshipTypes()
        if types_ctx:
            names = types_ctx.name()
            if names:
                for name_ctx in names:
                    rel_type = _strip_backticks(name_ctx.getText())
                    self.analysis.all_rel_types.add(rel_type)
                    self.analysis.label_tokens.append(
                        _LabelToken(
                            token_index=name_ctx.start.tokenIndex,
                            text=rel_type,
                            is_relationship=True,
                        )
                    )
                    if variable:
                        self.analysis.rel_variables[variable] = rel_type

    # -- property access (variable.property) --

    def enterPropertyExpression(self, ctx) -> None:
        atom = ctx.atom()
        if atom is None:
            return
        variable = _strip_backticks(atom.getText())
        names = ctx.name()
        if not names:
            return
        for name_ctx in names:
            prop_name = _strip_backticks(name_ctx.getText())
            self.analysis.property_accesses.append(
                _PropertyAccess(variable=variable, property_name=prop_name)
            )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _strip_backticks(name: str) -> str:
    if name.startswith("`") and name.endswith("`"):
        return name[1:-1]
    return name


# ---------------------------------------------------------------------------
# Parse → Analyze → Validate → Rewrite pipeline
# ---------------------------------------------------------------------------


def _parse(query: str) -> tuple[CommonTokenStream, CypherParser.ScriptContext]:
    """Lex + parse an OQL string. Raises on syntax errors."""
    input_stream = InputStream(query)
    lexer = CypherLexer(input_stream)
    lexer.removeErrorListeners()
    err = _SyntaxErrorListener()
    lexer.addErrorListener(err)

    token_stream = CommonTokenStream(lexer)
    parser = CypherParser(token_stream)
    parser.removeErrorListeners()
    parser.addErrorListener(err)

    tree = parser.script()

    if err.errors:
        raise ValidationError(
            "Invalid query syntax: " + "; ".join(err.errors)
        )
    return token_stream, tree


def _analyze(tree: CypherParser.ScriptContext) -> _Analysis:
    collector = _Collector()
    ParseTreeWalker().walk(collector, tree)
    return collector.analysis


def _validate(analysis: _Analysis, schema: SchemaCache) -> list[str]:
    """Return a list of human-readable validation errors (empty = OK).

    Error messages include hints about available types and properties so
    that LLMs (and humans) can self-correct their queries.
    """
    errors: list[str] = []

    # 1. Write clauses
    if analysis.write_clauses:
        clauses = ", ".join(sorted(set(analysis.write_clauses)))
        errors.append(
            f"Write operations are not allowed: {clauses}. "
            "Only read queries are supported (MATCH, WHERE, RETURN, "
            "ORDER BY, LIMIT, SKIP, OPTIONAL MATCH, WITH, UNWIND)."
        )

    # 2. CALL / procedures
    if analysis.has_call:
        errors.append(
            "CALL procedures are not allowed. "
            "Use MATCH patterns to query data."
        )

    # 3. Labelless nodes (scope leak)
    if analysis.has_labelless_nodes:
        available = sorted(schema.entity_types)
        errors.append(
            "All node patterns must specify a label. "
            f"Available entity types: {', '.join(available)}"
        )

    # 4. Node labels
    valid_entity_keys = set(schema.entity_types)
    for label in sorted(analysis.all_labels):
        if label in _INTERNAL_LABELS:
            errors.append(
                f"Internal label '{label}' cannot be queried directly. "
                f"Use entity type keys: {', '.join(sorted(valid_entity_keys))}"
            )
        elif label not in valid_entity_keys:
            errors.append(
                f"Unknown entity type: '{label}'. "
                f"Available: {', '.join(sorted(valid_entity_keys))}"
            )

    # 5. Relationship types
    valid_rel_keys = set(schema.relation_types)
    for rel_type in sorted(analysis.all_rel_types):
        if rel_type in _INTERNAL_REL_TYPES:
            errors.append(
                f"Internal relationship type '{rel_type}' cannot be queried "
                f"directly. Use relation type keys: "
                f"{', '.join(sorted(valid_rel_keys))}"
            )
        elif rel_type not in valid_rel_keys:
            errors.append(
                f"Unknown relation type: '{rel_type}'. "
                f"Available: {', '.join(sorted(valid_rel_keys))}"
            )

    # 6. Property accesses
    var_to_entity: dict[str, str] = {}
    for var, labels in analysis.node_variables.items():
        for lbl in labels:
            if lbl in valid_entity_keys:
                var_to_entity[var] = lbl
                break

    var_to_rel: dict[str, str] = {}
    for var, rtype in analysis.rel_variables.items():
        if rtype in valid_rel_keys:
            var_to_rel[var] = rtype

    for pa in analysis.property_accesses:
        if pa.property_name in SYSTEM_PROPERTIES:
            continue

        if pa.variable in var_to_entity:
            et_key = var_to_entity[pa.variable]
            et_props = schema.entity_types[et_key].properties
            if pa.property_name not in et_props:
                available = sorted(et_props) + sorted(SYSTEM_PROPERTIES)
                errors.append(
                    f"Unknown property '{pa.property_name}' "
                    f"on entity type '{et_key}'. "
                    f"Available: {', '.join(available)}"
                )
        elif pa.variable in var_to_rel:
            rt_key = var_to_rel[pa.variable]
            rt_props = schema.relation_types[rt_key].properties
            if pa.property_name not in rt_props:
                available = sorted(rt_props) + sorted(SYSTEM_PROPERTIES)
                errors.append(
                    f"Unknown property '{pa.property_name}' "
                    f"on relation type '{rt_key}'. "
                    f"Available: {', '.join(available)}"
                )
        # Variables not in the map (e.g. WITH aliases) are not validated.

    return errors


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


@dataclasses.dataclass
class ValidatedQuery:
    """A parsed and schema-validated OQL query.

    Opaque to services; database adapters compile it to their native
    dialect (token stream + analysis carry everything a compiler needs).
    """

    text: str
    token_stream: CommonTokenStream
    analysis: _Analysis


def parse_and_validate(query: str, schema: SchemaCache) -> ValidatedQuery:
    """Parse and validate an OQL query against the scoped schema.

    Raises ``ValidationError`` if the query is invalid.
    """
    token_stream, tree = _parse(query)
    analysis = _analyze(tree)
    errors = _validate(analysis, schema)
    if errors:
        raise ValidationError(
            "Query validation failed", details={"errors": errors}
        )
    return ValidatedQuery(text=query, token_stream=token_stream, analysis=analysis)


def get_return_variables(query: str, schema: SchemaCache) -> dict[str, str | None]:
    """Map variables used in the query to their schema type key (or None).

    Useful for post-processing results to filter properties per type.
    """
    _, tree = _parse(query)
    analysis = _analyze(tree)
    result: dict[str, str | None] = {}
    for var, labels in analysis.node_variables.items():
        for lbl in labels:
            if lbl in schema.entity_types:
                result[var] = lbl
                break
        else:
            result[var] = None
    for var, rtype in analysis.rel_variables.items():
        result[var] = rtype if rtype in schema.relation_types else None
    return result
