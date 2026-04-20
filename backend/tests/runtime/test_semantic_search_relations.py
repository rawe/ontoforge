"""Unit tests for semantic_search_relations: RRF fusion + edge cases."""

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ontoforge_server.runtime.service import (
    LoadedSchema,
    PropertyDef,
    RelationTypeDef,
    SchemaCache,
    _rrf_fuse,
    semantic_search_relations,
)


# ---------------------------------------------------------------------------
# RRF fusion
# ---------------------------------------------------------------------------


def _item(rid: str) -> dict:
    return {"_id": rid, "_relationTypeKey": "t", "source_id": "s", "target_id": "t",
            "_fact": f"fact for {rid}", "score": 0.0, "matched_via": ["vector"]}


def test_rrf_fuse_single_list():
    fused = _rrf_fuse([[_item("a"), _item("b"), _item("c")]], k=60)
    ids = [r["_id"] for r in fused]
    assert ids == ["a", "b", "c"]
    # Score for rank 0 = 1/(60+1), rank 1 = 1/62, rank 2 = 1/63.
    assert fused[0]["score"] > fused[1]["score"] > fused[2]["score"]


def test_rrf_fuse_combines_ranks_across_lists():
    # "a" appears top of both lists → strongest RRF score.
    list_a = [_item("a"), _item("x"), _item("y")]
    list_b = [_item("a"), _item("x")]
    fused = _rrf_fuse([list_a, list_b], k=60)
    assert fused[0]["_id"] == "a"
    # x is in both but lower in one → second-ranked.
    assert fused[1]["_id"] == "x"


def test_rrf_fuse_tiebreak_by_id():
    # Two items tied at the same rank across different single-source lists.
    list_a = [_item("b")]
    list_b = [_item("a")]
    fused = _rrf_fuse([list_a, list_b], k=60)
    # Both have score = 1/(60+1). Tiebreak by _id asc.
    assert [r["_id"] for r in fused] == ["a", "b"]


def test_rrf_fuse_empty_lists_empty_result():
    assert _rrf_fuse([], k=60) == []
    assert _rrf_fuse([[], []], k=60) == []


# ---------------------------------------------------------------------------
# semantic_search_relations
# ---------------------------------------------------------------------------


def _make_loaded(relation_types: dict[str, RelationTypeDef]) -> LoadedSchema:
    cache = SchemaCache(
        ontology_id="ont-1",
        ontology_key="test",
        ontology_name="Test",
        ontology_description=None,
    )
    cache.relation_types = relation_types
    return LoadedSchema(scoped=cache, full=cache)


def _rt(key: str, fact_template: str | None) -> RelationTypeDef:
    return RelationTypeDef(
        key=key,
        display_name=key.replace("_", " ").title(),
        description=None,
        from_entity_type_key="person",
        to_entity_type_key="company",
        fact_template=fact_template,
        properties={},
    )


@pytest.fixture
def mock_driver():
    driver = MagicMock()
    session = AsyncMock()

    @asynccontextmanager
    async def _session(**kwargs):
        yield session

    driver.session = _session
    return driver


LOAD = "ontoforge_server.runtime.service._load_schema"
PROVIDER = "ontoforge_server.runtime.service.get_embedding_provider"


@pytest.mark.asyncio
async def test_empty_eligible_relation_types_returns_empty(mock_driver):
    loaded = _make_loaded({"structural": _rt("structural", None)})
    with (
        patch(LOAD, new_callable=AsyncMock, return_value=loaded),
        patch(PROVIDER, return_value=MagicMock(embed=AsyncMock(return_value=[0.1]))),
    ):
        result = await semantic_search_relations(
            "test", "anything", 20, None, 60, mock_driver,
        )
    assert result == []


@pytest.mark.asyncio
async def test_no_provider_returns_empty(mock_driver):
    loaded = _make_loaded({"works_for": _rt("works_for", "{{ source.displayName }}")})
    with (
        patch(LOAD, new_callable=AsyncMock, return_value=loaded),
        patch(PROVIDER, return_value=None),
    ):
        result = await semantic_search_relations(
            "test", "anything", 20, None, 60, mock_driver,
        )
    assert result == []


@pytest.mark.asyncio
async def test_empty_query_embedding_returns_empty(mock_driver):
    loaded = _make_loaded({"works_for": _rt("works_for", "{{ source.displayName }}")})
    provider = MagicMock()
    provider.embed = AsyncMock(return_value=None)
    with (
        patch(LOAD, new_callable=AsyncMock, return_value=loaded),
        patch(PROVIDER, return_value=provider),
    ):
        result = await semantic_search_relations(
            "test", "anything", 20, None, 60, mock_driver,
        )
    assert result == []


@pytest.mark.asyncio
async def test_fan_out_and_fuse(mock_driver):
    loaded = _make_loaded(
        {
            "works_for": _rt("works_for", "{{ source.displayName }}"),
            "manages": _rt("manages", "{{ source.displayName }}"),
        }
    )
    provider = MagicMock()
    provider.embed = AsyncMock(return_value=[0.1, 0.2])

    # Return distinct per-type ranked lists.
    async def fake_search_one(driver, rel_type_upper, relation_type_key, *args):
        if relation_type_key == "works_for":
            return [
                {"_id": "r1", "_relationTypeKey": "works_for",
                 "source_id": "p1", "target_id": "c1",
                 "_fact": "Alice works for Acme", "score": 0.9,
                 "matched_via": ["vector"]},
                {"_id": "r2", "_relationTypeKey": "works_for",
                 "source_id": "p2", "target_id": "c1",
                 "_fact": "Bob works for Acme", "score": 0.6,
                 "matched_via": ["vector"]},
            ]
        return [
            {"_id": "r3", "_relationTypeKey": "manages",
             "source_id": "p1", "target_id": "p2",
             "_fact": "Alice manages Bob", "score": 0.8,
             "matched_via": ["vector"]},
        ]

    with (
        patch(LOAD, new_callable=AsyncMock, return_value=loaded),
        patch(PROVIDER, return_value=provider),
        patch(
            "ontoforge_server.runtime.service._search_one_relation_type",
            side_effect=fake_search_one,
        ),
    ):
        result = await semantic_search_relations(
            "test", "who works", 20, None, 60, mock_driver,
        )

    ids = [r["_id"] for r in result]
    assert set(ids) == {"r1", "r2", "r3"}
    # Highest-ranked item (rank 0 in works_for) should be first.
    assert result[0]["_id"] == "r1"
    # Response shape
    for row in result:
        assert set(row.keys()) == {
            "_id", "_relationTypeKey", "source_id", "target_id",
            "_fact", "score", "matched_via",
        }
        assert row["matched_via"] == ["vector"]


@pytest.mark.asyncio
async def test_per_type_error_isolated(mock_driver):
    """If one type raises inside _search_one_relation_type, its list is empty but
    the overall request still succeeds with results from the healthy type."""
    loaded = _make_loaded(
        {
            "works_for": _rt("works_for", "{{ source.displayName }}"),
            "broken": _rt("broken", "{{ source.displayName }}"),
        }
    )
    provider = MagicMock()
    provider.embed = AsyncMock(return_value=[0.1])

    async def fake_search_one(driver, rel_type_upper, relation_type_key, *args):
        # _search_one_relation_type swallows errors internally → empty list.
        if relation_type_key == "broken":
            return []
        return [
            {"_id": "r1", "_relationTypeKey": "works_for",
             "source_id": "p1", "target_id": "c1",
             "_fact": "Alice works for Acme", "score": 0.9,
             "matched_via": ["vector"]},
        ]

    with (
        patch(LOAD, new_callable=AsyncMock, return_value=loaded),
        patch(PROVIDER, return_value=provider),
        patch(
            "ontoforge_server.runtime.service._search_one_relation_type",
            side_effect=fake_search_one,
        ),
    ):
        result = await semantic_search_relations(
            "test", "q", 20, None, 60, mock_driver,
        )

    assert len(result) == 1
    assert result[0]["_id"] == "r1"
