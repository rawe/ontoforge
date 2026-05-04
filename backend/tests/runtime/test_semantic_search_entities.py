"""Unit tests for semantic_search_entities (M4 §6.3).

Mock-driver tests covering the service layer end-to-end: scope handling,
overfetch, projection, and edge cases. Mirrors the pattern of
``test_semantic_search_relations.py`` but verifies a single global Cypher
call (no fan-out, no RRF).
"""

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ontoforge_server.runtime.service import (
    EntityTypeDef,
    LoadedSchema,
    PropertyDef,
    SchemaCache,
    semantic_search_entities,
)


LOAD = "ontoforge_server.runtime.service._load_schema"
PROVIDER = "ontoforge_server.runtime.service.get_embedding_provider"
REPO_FN = "ontoforge_server.runtime.service.repository.semantic_search_entities_global"


def _string_prop(key: str) -> PropertyDef:
    return PropertyDef(
        key=key,
        display_name=key.title(),
        description=None,
        data_type="string",
        required=False,
        default_value=None,
    )


def _et(
    key: str,
    properties: list[str],
    *,
    display_name_property: str | None = None,
    default_search_properties: list[str] | None = None,
) -> EntityTypeDef:
    return EntityTypeDef(
        key=key,
        display_name=key.title(),
        description=None,
        properties={p: _string_prop(p) for p in properties},
        display_name_property=display_name_property,
        default_search_properties=list(default_search_properties or []),
    )


def _make_loaded(
    *,
    full_types: dict[str, EntityTypeDef],
    scoped_types: dict[str, EntityTypeDef] | None = None,
) -> LoadedSchema:
    full = SchemaCache(
        ontology_id="ont-1",
        ontology_key="test",
        ontology_name="Test",
        ontology_description=None,
    )
    full.entity_types = full_types
    scoped_cache = SchemaCache(
        ontology_id="ont-1",
        ontology_key="test",
        ontology_name="Test",
        ontology_description=None,
    )
    scoped_cache.entity_types = scoped_types if scoped_types is not None else full_types
    return LoadedSchema(scoped=scoped_cache, full=full)


@pytest.fixture
def mock_driver():
    driver = MagicMock()
    session = AsyncMock()

    @asynccontextmanager
    async def _session(**kwargs):
        yield session

    driver.session = _session
    return driver


# ---------------------------------------------------------------------------
# Provider / embedding edge cases
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_no_provider_returns_empty(mock_driver):
    loaded = _make_loaded(full_types={"person": _et("person", ["name"])})
    with (
        patch(LOAD, new_callable=AsyncMock, return_value=loaded),
        patch(PROVIDER, return_value=None),
        patch(REPO_FN, new_callable=AsyncMock) as repo_call,
    ):
        result = await semantic_search_entities(
            "test", "anything", 10, None, None, mock_driver,
        )
    assert result == []
    repo_call.assert_not_called()


@pytest.mark.asyncio
async def test_empty_query_embedding_returns_empty(mock_driver):
    loaded = _make_loaded(full_types={"person": _et("person", ["name"])})
    provider = MagicMock()
    provider.embed = AsyncMock(return_value=None)
    with (
        patch(LOAD, new_callable=AsyncMock, return_value=loaded),
        patch(PROVIDER, return_value=provider),
        patch(REPO_FN, new_callable=AsyncMock) as repo_call,
    ):
        result = await semantic_search_entities(
            "test", "anything", 10, None, None, mock_driver,
        )
    assert result == []
    repo_call.assert_not_called()


# ---------------------------------------------------------------------------
# Scope plumbing
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unscoped_passes_none_allowed_keys(mock_driver):
    """When scoped == full, the service must pass allowed_keys=None."""
    full = {
        "person": _et("person", ["name"]),
        "company": _et("company", ["name"]),
    }
    loaded = _make_loaded(full_types=full)  # scoped defaults to full
    provider = MagicMock()
    provider.embed = AsyncMock(return_value=[0.1, 0.2])
    repo = AsyncMock(return_value=[])

    with (
        patch(LOAD, new_callable=AsyncMock, return_value=loaded),
        patch(PROVIDER, return_value=provider),
        patch(REPO_FN, new=repo),
    ):
        await semantic_search_entities("test", "q", 10, None, None, mock_driver)

    args, kwargs = repo.call_args
    # session, query_embedding, internal_limit, allowed_keys, group_id, min_score
    assert args[3] is None


@pytest.mark.asyncio
async def test_scoped_passes_only_scoped_keys(mock_driver):
    """When scoped is a strict subset of full, only the scoped keys are passed."""
    full = {
        "person": _et("person", ["name"]),
        "company": _et("company", ["name"]),
        "department": _et("department", ["name"]),
    }
    scoped = {"person": _et("person", ["name"])}
    loaded = _make_loaded(full_types=full, scoped_types=scoped)
    provider = MagicMock()
    provider.embed = AsyncMock(return_value=[0.1])
    repo = AsyncMock(return_value=[])

    with (
        patch(LOAD, new_callable=AsyncMock, return_value=loaded),
        patch(PROVIDER, return_value=provider),
        patch(REPO_FN, new=repo),
    ):
        await semantic_search_entities("test", "q", 10, None, None, mock_driver)

    args, _ = repo.call_args
    assert args[3] == ["person"]


# ---------------------------------------------------------------------------
# Overfetch + plumbing of group_id / min_score
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_overfetch_multiplier_is_5x(mock_driver):
    loaded = _make_loaded(full_types={"person": _et("person", ["name"])})
    provider = MagicMock()
    provider.embed = AsyncMock(return_value=[0.1])
    repo = AsyncMock(return_value=[])

    with (
        patch(LOAD, new_callable=AsyncMock, return_value=loaded),
        patch(PROVIDER, return_value=provider),
        patch(REPO_FN, new=repo),
    ):
        await semantic_search_entities("test", "q", 7, None, None, mock_driver)

    args, _ = repo.call_args
    # internal_limit is the third positional argument
    assert args[2] == 35


@pytest.mark.asyncio
async def test_group_id_and_min_score_plumbed(mock_driver):
    loaded = _make_loaded(full_types={"person": _et("person", ["name"])})
    provider = MagicMock()
    provider.embed = AsyncMock(return_value=[0.1])
    repo = AsyncMock(return_value=[])

    with (
        patch(LOAD, new_callable=AsyncMock, return_value=loaded),
        patch(PROVIDER, return_value=provider),
        patch(REPO_FN, new=repo),
    ):
        await semantic_search_entities(
            "test", "q", 5, "tenant_42", 0.4, mock_driver,
        )

    args, _ = repo.call_args
    assert args[4] == "tenant_42"  # group_id
    assert args[5] == 0.4          # min_score


# ---------------------------------------------------------------------------
# Projection and display name
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_display_name_populated_when_configured(mock_driver):
    person = _et(
        "person", ["name", "role"],
        display_name_property="name",
        default_search_properties=["role"],
    )
    loaded = _make_loaded(full_types={"person": person})
    provider = MagicMock()
    provider.embed = AsyncMock(return_value=[0.1])
    repo = AsyncMock(return_value=[
        {
            "entity": {
                "_id": "p1",
                "_entityTypeKey": "person",
                "name": "Alice Chen",
                "role": "Senior Engineer",
            },
            "score": 0.92,
            "type_key": "person",
            "id": "p1",
        }
    ])

    with (
        patch(LOAD, new_callable=AsyncMock, return_value=loaded),
        patch(PROVIDER, return_value=provider),
        patch(REPO_FN, new=repo),
    ):
        result = await semantic_search_entities(
            "test", "q", 5, None, None, mock_driver,
        )

    assert len(result) == 1
    row = result[0]
    assert row["_id"] == "p1"
    assert row["_entityTypeKey"] == "person"
    assert row["displayName"] == "Alice Chen"
    assert row["properties"] == {"role": "Senior Engineer"}
    assert row["score"] == 0.92
    assert row["matched_via"] == ["vector"]


@pytest.mark.asyncio
async def test_display_name_null_when_unset(mock_driver):
    person = _et("person", ["name"])  # no displayNameProperty
    loaded = _make_loaded(full_types={"person": person})
    provider = MagicMock()
    provider.embed = AsyncMock(return_value=[0.1])
    repo = AsyncMock(return_value=[
        {
            "entity": {"_id": "p1", "_entityTypeKey": "person", "name": "Alice"},
            "score": 0.9,
            "type_key": "person",
            "id": "p1",
        }
    ])

    with (
        patch(LOAD, new_callable=AsyncMock, return_value=loaded),
        patch(PROVIDER, return_value=provider),
        patch(REPO_FN, new=repo),
    ):
        result = await semantic_search_entities(
            "test", "q", 5, None, None, mock_driver,
        )

    assert result[0]["displayName"] is None
    assert result[0]["properties"] == {}


@pytest.mark.asyncio
async def test_properties_projection_only_in_scope_and_present(mock_driver):
    """defaultSearchProperties list members are only emitted when in scope."""
    # `bio` is in default_search_properties but NOT in scoped properties -
    # must be filtered out.
    full = _et(
        "person",
        ["name", "role", "bio"],
        display_name_property="name",
        default_search_properties=["role", "bio", "missing"],
    )
    scoped = _et(
        "person",
        ["name", "role"],  # bio filtered out by ontology scope
        display_name_property="name",
        default_search_properties=["role", "bio", "missing"],
    )
    loaded = _make_loaded(full_types={"person": full}, scoped_types={"person": scoped})
    provider = MagicMock()
    provider.embed = AsyncMock(return_value=[0.1])
    repo = AsyncMock(return_value=[
        {
            "entity": {
                "_id": "p1",
                "_entityTypeKey": "person",
                "name": "Alice",
                "role": "Engineer",
                "bio": "Builds systems",
                # 'missing' deliberately absent
            },
            "score": 0.9,
            "type_key": "person",
            "id": "p1",
        }
    ])

    with (
        patch(LOAD, new_callable=AsyncMock, return_value=loaded),
        patch(PROVIDER, return_value=provider),
        patch(REPO_FN, new=repo),
    ):
        result = await semantic_search_entities(
            "test", "q", 5, None, None, mock_driver,
        )

    # `bio` filtered by scope, `missing` filtered by absence on the node.
    assert result[0]["properties"] == {"role": "Engineer"}


@pytest.mark.asyncio
async def test_display_name_out_of_scope_returns_null(mock_driver):
    """displayNameProperty referencing an out-of-scope key yields displayName=None."""
    full = _et("person", ["name", "secret"], display_name_property="secret")
    scoped = _et("person", ["name"], display_name_property="secret")
    loaded = _make_loaded(full_types={"person": full}, scoped_types={"person": scoped})
    provider = MagicMock()
    provider.embed = AsyncMock(return_value=[0.1])
    repo = AsyncMock(return_value=[
        {
            "entity": {"_id": "p1", "_entityTypeKey": "person", "name": "Alice", "secret": "x"},
            "score": 0.9,
            "type_key": "person",
            "id": "p1",
        }
    ])

    with (
        patch(LOAD, new_callable=AsyncMock, return_value=loaded),
        patch(PROVIDER, return_value=provider),
        patch(REPO_FN, new=repo),
    ):
        result = await semantic_search_entities(
            "test", "q", 5, None, None, mock_driver,
        )

    assert result[0]["displayName"] is None


@pytest.mark.asyncio
async def test_truncates_to_limit(mock_driver):
    person = _et("person", ["name"])
    loaded = _make_loaded(full_types={"person": person})
    provider = MagicMock()
    provider.embed = AsyncMock(return_value=[0.1])
    # Repo returns 6 rows; limit=2 so only 2 come back.
    rows = [
        {
            "entity": {"_id": f"p{i}", "_entityTypeKey": "person", "name": f"A{i}"},
            "score": 1.0 - i * 0.1,
            "type_key": "person",
            "id": f"p{i}",
        }
        for i in range(6)
    ]
    repo = AsyncMock(return_value=rows)

    with (
        patch(LOAD, new_callable=AsyncMock, return_value=loaded),
        patch(PROVIDER, return_value=provider),
        patch(REPO_FN, new=repo),
    ):
        result = await semantic_search_entities(
            "test", "q", 2, None, None, mock_driver,
        )

    assert len(result) == 2
    assert [r["_id"] for r in result] == ["p0", "p1"]


@pytest.mark.asyncio
async def test_out_of_scope_type_match_filtered(mock_driver):
    """A repo row whose type isn't in the scoped cache must be dropped.

    This guards against unscoped-flag drift: a stale loaded.scoped that
    omits a type still in loaded.full should not leak that type through.
    """
    full = {
        "person": _et("person", ["name"]),
        "company": _et("company", ["name"]),
    }
    scoped = {"person": _et("person", ["name"])}
    loaded = _make_loaded(full_types=full, scoped_types=scoped)
    provider = MagicMock()
    provider.embed = AsyncMock(return_value=[0.1])
    repo = AsyncMock(return_value=[
        {
            "entity": {"_id": "p1", "_entityTypeKey": "person", "name": "Alice"},
            "score": 0.9,
            "type_key": "person",
            "id": "p1",
        },
        {
            "entity": {"_id": "c1", "_entityTypeKey": "company", "name": "Acme"},
            "score": 0.8,
            "type_key": "company",
            "id": "c1",
        },
    ])

    with (
        patch(LOAD, new_callable=AsyncMock, return_value=loaded),
        patch(PROVIDER, return_value=provider),
        patch(REPO_FN, new=repo),
    ):
        result = await semantic_search_entities(
            "test", "q", 5, None, None, mock_driver,
        )

    assert [r["_id"] for r in result] == ["p1"]
