"""Tests for OQL parsing/validation (core.oql), the Neo4j compiler, and the endpoint."""

from unittest.mock import AsyncMock, patch

import pytest

from ontoforge_server.core.exceptions import ValidationError
from ontoforge_server.adapters.neo4j.oql_compiler import (
    compile_query,
    validate_and_compile,
)
from ontoforge_server.core.oql import (
    SYSTEM_PROPERTIES,
    ValidatedQuery,
    _analyze,
    _parse,
    _validate,
    get_return_variables,
)
from ontoforge_server.runtime.service import (
    EntityTypeDef,
    PropertyDef,
    RelationTypeDef,
    SchemaCache,
)
from tests.runtime.conftest import EMBEDDING, REPO, make_entity


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _schema() -> SchemaCache:
    """Minimal scoped schema for testing."""
    return SchemaCache(
        ontology_id="ont-1",
        ontology_key="test",
        ontology_name="Test",
        ontology_description=None,
        entity_types={
            "person": EntityTypeDef(
                key="person",
                display_name="Person",
                description=None,
                properties={
                    "name": PropertyDef(
                        key="name", display_name="Name", description=None,
                        data_type="string", required=True, default_value=None,
                    ),
                    "age": PropertyDef(
                        key="age", display_name="Age", description=None,
                        data_type="integer", required=False, default_value=None,
                    ),
                },
            ),
            "company": EntityTypeDef(
                key="company",
                display_name="Company",
                description=None,
                properties={
                    "name": PropertyDef(
                        key="name", display_name="Name", description=None,
                        data_type="string", required=True, default_value=None,
                    ),
                },
            ),
        },
        relation_types={
            "works_for": RelationTypeDef(
                key="works_for",
                display_name="Works For",
                description=None,
                from_entity_type_key="person",
                to_entity_type_key="company",
                properties={
                    "role": PropertyDef(
                        key="role", display_name="Role", description=None,
                        data_type="string", required=False, default_value=None,
                    ),
                },
            ),
        },
    )


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------


class TestParsing:
    def test_valid_query_parses(self):
        ts, tree = _parse("MATCH (n:person) RETURN n")
        assert tree is not None

    def test_syntax_error_raises(self):
        with pytest.raises(ValidationError, match="Invalid query syntax"):
            _parse("MATCH (n:person RETURN")


# ---------------------------------------------------------------------------
# Analysis — label extraction
# ---------------------------------------------------------------------------


class TestAnalysis:
    def test_extracts_node_labels(self):
        _, tree = _parse("MATCH (p:person)-[r:works_for]->(c:company) RETURN p")
        analysis = _analyze(tree)
        assert analysis.all_labels == {"person", "company"}

    def test_extracts_rel_types(self):
        _, tree = _parse("MATCH (p:person)-[r:works_for]->(c:company) RETURN p")
        analysis = _analyze(tree)
        assert analysis.all_rel_types == {"works_for"}

    def test_node_variable_mapping(self):
        _, tree = _parse("MATCH (p:person) RETURN p")
        analysis = _analyze(tree)
        assert analysis.node_variables == {"p": {"person"}}

    def test_rel_variable_mapping(self):
        _, tree = _parse("MATCH ()-[r:works_for]->() RETURN r")
        analysis = _analyze(tree)
        assert analysis.rel_variables == {"r": "works_for"}

    def test_detects_write_create(self):
        _, tree = _parse("CREATE (n:person {name: 'Bob'})")
        analysis = _analyze(tree)
        assert "CREATE" in analysis.write_clauses

    def test_detects_write_delete(self):
        _, tree = _parse("MATCH (n:person) DELETE n")
        analysis = _analyze(tree)
        assert "DELETE" in analysis.write_clauses

    def test_detects_write_set(self):
        _, tree = _parse("MATCH (n:person) SET n.name = 'Bob'")
        analysis = _analyze(tree)
        assert "SET" in analysis.write_clauses

    def test_detects_write_merge(self):
        _, tree = _parse("MERGE (n:person {name: 'Bob'})")
        analysis = _analyze(tree)
        assert "MERGE" in analysis.write_clauses

    def test_detects_write_remove(self):
        _, tree = _parse("MATCH (n:person) REMOVE n.age")
        analysis = _analyze(tree)
        assert "REMOVE" in analysis.write_clauses

    def test_detects_call(self):
        _, tree = _parse("CALL db.labels()")
        analysis = _analyze(tree)
        assert analysis.has_call is True

    def test_property_access(self):
        _, tree = _parse("MATCH (p:person) WHERE p.name = 'Alice' RETURN p.age")
        analysis = _analyze(tree)
        props = [(pa.variable, pa.property_name) for pa in analysis.property_accesses]
        assert ("p", "name") in props
        assert ("p", "age") in props

    def test_labelless_node_detected(self):
        _, tree = _parse("MATCH (n) RETURN n")
        analysis = _analyze(tree)
        assert analysis.has_labelless_nodes is True

    def test_labeled_node_not_flagged(self):
        _, tree = _parse("MATCH (n:person) RETURN n")
        analysis = _analyze(tree)
        assert analysis.has_labelless_nodes is False


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


class TestValidation:
    def test_valid_query_no_errors(self):
        _, tree = _parse("MATCH (p:person) RETURN p")
        errors = _validate(_analyze(tree), _schema())
        assert errors == []

    def test_rejects_write_create(self):
        _, tree = _parse("CREATE (n:person {name: 'Bob'})")
        errors = _validate(_analyze(tree), _schema())
        assert any("Write operations" in e for e in errors)

    def test_rejects_call(self):
        _, tree = _parse("CALL db.labels()")
        errors = _validate(_analyze(tree), _schema())
        assert any("CALL procedures" in e for e in errors)

    def test_rejects_labelless_node(self):
        _, tree = _parse("MATCH (n) RETURN n")
        errors = _validate(_analyze(tree), _schema())
        assert any("must specify a label" in e for e in errors)

    def test_rejects_unknown_entity_type(self):
        _, tree = _parse("MATCH (n:animal) RETURN n")
        errors = _validate(_analyze(tree), _schema())
        assert any("Unknown entity type: 'animal'" in e for e in errors)

    def test_rejects_unknown_relation_type(self):
        _, tree = _parse("MATCH ()-[r:likes]->() RETURN r")
        errors = _validate(_analyze(tree), _schema())
        assert any("Unknown relation type: 'likes'" in e for e in errors)

    def test_rejects_internal_label(self):
        _, tree = _parse("MATCH (n:_Entity) RETURN n")
        errors = _validate(_analyze(tree), _schema())
        assert any("Internal label" in e for e in errors)

    def test_rejects_unknown_entity_property(self):
        _, tree = _parse("MATCH (p:person) WHERE p.salary = 100 RETURN p")
        errors = _validate(_analyze(tree), _schema())
        assert any("Unknown property 'salary'" in e for e in errors)

    def test_rejects_unknown_relation_property(self):
        _, tree = _parse(
            "MATCH ()-[r:works_for]->() WHERE r.rating = 5 RETURN r"
        )
        errors = _validate(_analyze(tree), _schema())
        assert any("Unknown property 'rating'" in e for e in errors)

    def test_allows_system_properties(self):
        _, tree = _parse("MATCH (p:person) WHERE p._id = 'abc' RETURN p._createdAt")
        errors = _validate(_analyze(tree), _schema())
        assert errors == []

    def test_allows_known_properties(self):
        _, tree = _parse("MATCH (p:person) WHERE p.name = 'Alice' RETURN p.age")
        errors = _validate(_analyze(tree), _schema())
        assert errors == []

    def test_error_hints_include_available_types(self):
        _, tree = _parse("MATCH (n:animal) RETURN n")
        errors = _validate(_analyze(tree), _schema())
        assert any("company" in e and "person" in e for e in errors)

    def test_error_hints_include_available_properties(self):
        _, tree = _parse("MATCH (p:person) WHERE p.salary = 100 RETURN p")
        errors = _validate(_analyze(tree), _schema())
        assert any("name" in e and "age" in e for e in errors)

    def test_multiple_errors_collected(self):
        _, tree = _parse(
            "MATCH (n:animal)-[r:likes]->(m:person) WHERE m.salary = 1 RETURN n"
        )
        errors = _validate(_analyze(tree), _schema())
        assert len(errors) >= 3  # unknown entity, unknown rel, unknown prop


# ---------------------------------------------------------------------------
# Rewriting
# ---------------------------------------------------------------------------


class TestRewriting:
    def test_rewrites_entity_labels(self):
        ts, tree = _parse("MATCH (p:person) RETURN p")
        analysis = _analyze(tree)
        result = compile_query(ValidatedQuery(text="", token_stream=ts, analysis=analysis))
        assert ":Person)" in result
        assert ":person)" not in result

    def test_rewrites_relation_types(self):
        ts, tree = _parse(
            "MATCH (p:person)-[r:works_for]->(c:company) RETURN p, c"
        )
        analysis = _analyze(tree)
        result = compile_query(ValidatedQuery(text="", token_stream=ts, analysis=analysis))
        assert ":WORKS_FOR]" in result
        assert ":Person)" in result
        assert ":Company)" in result

    def test_preserves_query_structure(self):
        query = "MATCH (p:person) WHERE p.name = 'Alice' RETURN p LIMIT 10"
        ts, tree = _parse(query)
        analysis = _analyze(tree)
        result = compile_query(ValidatedQuery(text="", token_stream=ts, analysis=analysis))
        assert "WHERE p.name = 'Alice'" in result
        assert "LIMIT 10" in result

    def test_multi_word_entity_pascal_case(self):
        schema = SchemaCache(
            ontology_id="t", ontology_key="t", ontology_name="T",
            ontology_description=None,
            entity_types={
                "research_paper": EntityTypeDef(
                    key="research_paper", display_name="Research Paper",
                    description=None, properties={},
                ),
            },
            relation_types={},
        )
        result = validate_and_compile(
            "MATCH (r:research_paper) RETURN r", schema
        )
        assert ":ResearchPaper)" in result


# ---------------------------------------------------------------------------
# validate_and_rewrite (end-to-end)
# ---------------------------------------------------------------------------


class TestValidateAndRewrite:
    def test_full_pipeline(self):
        result = validate_and_compile(
            "MATCH (p:person)-[r:works_for]->(c:company) "
            "WHERE p.name = 'Alice' RETURN p, r, c LIMIT 10",
            _schema(),
        )
        assert ":Person)" in result
        assert ":WORKS_FOR]" in result
        assert ":Company)" in result

    def test_raises_on_write(self):
        with pytest.raises(ValidationError):
            validate_and_compile("CREATE (n:person {name: 'Bob'})", _schema())

    def test_raises_on_unknown_label(self):
        with pytest.raises(ValidationError):
            validate_and_compile("MATCH (n:animal) RETURN n", _schema())

    def test_optional_match_supported(self):
        result = validate_and_compile(
            "MATCH (p:person) OPTIONAL MATCH (p)-[r:works_for]->(c:company) "
            "RETURN p, r, c",
            _schema(),
        )
        assert "OPTIONAL MATCH" in result
        assert ":Person)" in result

    def test_with_clause_supported(self):
        result = validate_and_compile(
            "MATCH (p:person) WITH p MATCH (p)-[r:works_for]->(c:company) "
            "RETURN p, c",
            _schema(),
        )
        assert "WITH p" in result

    def test_order_by_limit_skip(self):
        result = validate_and_compile(
            "MATCH (p:person) RETURN p ORDER BY p.name SKIP 5 LIMIT 10",
            _schema(),
        )
        assert "ORDER BY" in result
        assert "SKIP 5" in result
        assert "LIMIT 10" in result


# ---------------------------------------------------------------------------
# get_return_variables
# ---------------------------------------------------------------------------


class TestGetReturnVariables:
    def test_maps_node_variables(self):
        result = get_return_variables(
            "MATCH (p:person)-[r:works_for]->(c:company) RETURN p, r, c",
            _schema(),
        )
        assert result["p"] == "person"
        assert result["r"] == "works_for"
        assert result["c"] == "company"


# ---------------------------------------------------------------------------
# REST endpoint (via HTTP client)
# ---------------------------------------------------------------------------

CYPHER_REPO = "ontoforge_server.adapters.neo4j.runtime_queries"


@pytest.mark.asyncio
async def test_query_endpoint_success(client, unscoped_schema):
    """POST /api/runtime/{key}/query returns Cypher results."""
    raw_entity = make_entity(name="Alice", age=30)
    mock_execute = AsyncMock(
        return_value=(["p"], [{"p": raw_entity}])
    )

    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=unscoped_schema),
        patch(f"{CYPHER_REPO}.execute_cypher_read", mock_execute),
        patch(EMBEDDING, return_value=None),
    ):
        resp = await client.post(
            "/api/runtime/full_ontology/query",
            json={"query": "MATCH (p:person) RETURN p"},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["columns"] == ["p"]
    assert len(body["results"]) == 1
    assert body["results"][0]["p"]["name"] == "Alice"


async def test_query_endpoint_accepts_deprecated_cypher_field(client, unscoped_schema):
    """The legacy request field "cypher" is a deprecated alias for "query"."""
    raw_entity = make_entity(name="Alice", age=30)
    mock_execute = AsyncMock(
        return_value=(["p"], [{"p": raw_entity}])
    )

    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=unscoped_schema),
        patch(f"{CYPHER_REPO}.execute_cypher_read", mock_execute),
        patch(EMBEDDING, return_value=None),
    ):
        resp = await client.post(
            "/api/runtime/full_ontology/query",
            json={"cypher": "MATCH (p:person) RETURN p"},
        )

    assert resp.status_code == 200
    assert resp.json()["columns"] == ["p"]


@pytest.mark.asyncio
async def test_query_endpoint_rejects_write(client, unscoped_schema):
    """POST /api/runtime/{key}/query rejects write operations."""
    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=unscoped_schema),
        patch(EMBEDDING, return_value=None),
    ):
        resp = await client.post(
            "/api/runtime/full_ontology/query",
            json={"query": "CREATE (n:person {name: 'Bob'})"},
        )

    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_query_endpoint_rejects_unknown_type(client, unscoped_schema):
    """POST /api/runtime/{key}/query rejects unknown entity types."""
    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=unscoped_schema),
        patch(EMBEDDING, return_value=None),
    ):
        resp = await client.post(
            "/api/runtime/full_ontology/query",
            json={"query": "MATCH (n:animal) RETURN n"},
        )

    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_query_endpoint_scoped_filters_properties(client, scoped_schema):
    """Scoped ontology: out-of-scope properties are stripped from results."""
    # Repository returns entity with all props including out-of-scope 'age'
    raw_entity = make_entity(name="Alice", age=30, email="a@b.com")
    mock_execute = AsyncMock(
        return_value=(["p"], [{"p": raw_entity}])
    )

    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=scoped_schema),
        patch(f"{CYPHER_REPO}.execute_cypher_read", mock_execute),
        patch(EMBEDDING, return_value=None),
    ):
        resp = await client.post(
            "/api/runtime/hr_view/query",
            json={"query": "MATCH (p:person) RETURN p"},
        )

    assert resp.status_code == 200
    result_p = resp.json()["results"][0]["p"]
    assert result_p["name"] == "Alice"
    assert result_p["email"] == "a@b.com"
    assert "age" not in result_p  # out of scope


# ---------------------------------------------------------------------------
# Document properties: internal chunk blocklist + result stubs
# ---------------------------------------------------------------------------


def _doc_schema_cache() -> SchemaCache:
    """Scoped schema whose person type has a document property."""
    schema = _schema()
    schema.entity_types["person"].properties["bio"] = PropertyDef(
        key="bio", display_name="Bio", description=None,
        data_type="document", required=False, default_value=None,
    )
    return schema


class TestChunkBlocklist:
    def test_chunk_label_rejected(self):
        _, tree = _parse("MATCH (c:_Chunk) RETURN c")
        errors = _validate(_analyze(tree), _schema())
        assert any("Internal label '_Chunk'" in e for e in errors)

    def test_has_chunk_relationship_rejected(self):
        _, tree = _parse("MATCH (p:person)-[r:_HAS_CHUNK]->(c:person) RETURN c")
        errors = _validate(_analyze(tree), _schema())
        assert any("Internal relationship type '_HAS_CHUNK'" in e for e in errors)

    def test_virtual_chunk_label_rejected_as_unknown(self):
        _, tree = _parse("MATCH (c:PersonDocumentBio) RETURN c")
        errors = _validate(_analyze(tree), _schema())
        assert any("Unknown entity type: 'PersonDocumentBio'" in e for e in errors)

    def test_document_property_reference_is_valid(self):
        """Document properties remain valid property references in queries."""
        _, tree = _parse("MATCH (p:person) WHERE p.bio IS NOT NULL RETURN p")
        errors = _validate(_analyze(tree), _doc_schema_cache())
        assert errors == []


@pytest.mark.asyncio
async def test_query_endpoint_stubs_document_values_in_nodes(client):
    """Full nodes returned by Cypher carry document stubs, never content."""
    from tests.runtime.test_documents import _doc_schema

    raw_entity = make_entity(name="Ada", bio="x" * 500, _doc_bio_length=500)
    mock_execute = AsyncMock(return_value=(["p"], [{"p": raw_entity}]))

    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=_doc_schema()),
        patch(f"{CYPHER_REPO}.execute_cypher_read", mock_execute),
        patch(EMBEDDING, return_value=None),
    ):
        resp = await client.post(
            "/api/runtime/docs_view/query",
            json={"query": "MATCH (p:person) RETURN p"},
        )

    assert resp.status_code == 200
    result_p = resp.json()["results"][0]["p"]
    assert result_p["name"] == "Ada"
    assert result_p["bio"] == {"document": True, "length": 500}
    assert "_doc_bio_length" not in result_p


@pytest.mark.asyncio
async def test_query_endpoint_stubs_scalar_document_projection(client):
    """`RETURN p.bio` scalar columns are stubbed as well."""
    from tests.runtime.test_documents import _doc_schema

    mock_execute = AsyncMock(
        return_value=(["p.bio", "p.name"], [{"p.bio": "x" * 500, "p.name": "Ada"}])
    )

    with (
        patch(f"{REPO}.get_full_schema", new_callable=AsyncMock, return_value=_doc_schema()),
        patch(f"{CYPHER_REPO}.execute_cypher_read", mock_execute),
        patch(EMBEDDING, return_value=None),
    ):
        resp = await client.post(
            "/api/runtime/docs_view/query",
            json={"query": "MATCH (p:person) RETURN p.bio, p.name"},
        )

    assert resp.status_code == 200
    row = resp.json()["results"][0]
    assert row["p.bio"] == {"document": True, "length": 500}
    assert row["p.name"] == "Ada"
