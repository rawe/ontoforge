"""Integration tests for cross-type entity semantic search (M4 §7.4).

Requirements:
  - Neo4j running (default: bolt://localhost:7687)
  - Ollama running with embedding model (default: nomic-embed-text)

Run with: uv run pytest tests/integration/test_semantic_search_entities.py -v -m integration
"""

import pytest

from ontoforge_server.config import settings
from ontoforge_server.core.embedding import (
    close_embedding_provider,
    init_embedding_provider,
)
from tests.integration.conftest import check_neo4j, check_ollama_model

EMBEDDING_MODEL = "nomic-embed-text"

pytestmark = pytest.mark.integration


@pytest.fixture(scope="module")
async def services_available():
    if not await check_neo4j():
        pytest.skip("Neo4j not available")
    if not await check_ollama_model(EMBEDDING_MODEL):
        pytest.skip(f"Ollama not available or model '{EMBEDDING_MODEL}' not pulled")


@pytest.fixture(autouse=True)
async def _configure_embedding(services_available):
    original = settings.EMBEDDING_PROVIDER
    settings.EMBEDDING_PROVIDER = "ollama"
    await init_embedding_provider()
    yield
    await close_embedding_provider()
    settings.EMBEDDING_PROVIDER = original


async def _create_property(
    client, et_id: str, key: str, data_type: str = "string", required: bool = False
):
    resp = await client.post(
        f"/api/model/entity-types/{et_id}/properties",
        json={
            "key": key,
            "displayName": key.replace("_", " ").title(),
            "dataType": data_type,
            "required": required,
        },
    )
    assert resp.status_code == 201, f"Create property failed: {resp.text}"


@pytest.fixture
async def two_type_ontology(integration_client):
    """Ontology with both `person` and `company` entity types."""
    client = integration_client

    resp = await client.post("/api/model/ontologies", json={
        "key": "search_entities_test",
        "name": "Cross-type Search Test",
    })
    assert resp.status_code == 201
    ontology_id = resp.json()["ontologyId"]

    # person
    resp = await client.post("/api/model/entity-types", json={
        "key": "person",
        "displayName": "Person",
    })
    assert resp.status_code == 201, resp.text
    person_id = resp.json()["entityTypeId"]
    await _create_property(client, person_id, "name", required=True)
    await _create_property(client, person_id, "role")
    await _create_property(client, person_id, "bio")

    # company
    resp = await client.post("/api/model/entity-types", json={
        "key": "company",
        "displayName": "Company",
    })
    assert resp.status_code == 201, resp.text
    company_id = resp.json()["entityTypeId"]
    await _create_property(client, company_id, "name", required=True)
    await _create_property(client, company_id, "industry")

    yield {
        "ontology_id": ontology_id,
        "ontology_key": "search_entities_test",
        "person_id": person_id,
        "company_id": company_id,
    }


@pytest.fixture
async def two_type_ontology_with_projection(integration_client, two_type_ontology):
    """two_type_ontology with displayNameProperty + defaultSearchProperties set."""
    client = integration_client
    person_id = two_type_ontology["person_id"]
    company_id = two_type_ontology["company_id"]

    resp = await client.put(
        f"/api/model/entity-types/{person_id}",
        json={
            "displayNameProperty": "name",
            "defaultSearchProperties": ["role", "bio"],
        },
    )
    assert resp.status_code == 200, resp.text

    resp = await client.put(
        f"/api/model/entity-types/{company_id}",
        json={
            "displayNameProperty": "name",
            "defaultSearchProperties": ["industry"],
        },
    )
    assert resp.status_code == 200, resp.text

    return two_type_ontology


# ---------------------------------------------------------------------------
# Cases 1-2: cross-type behaviour, score ordering
# ---------------------------------------------------------------------------


async def test_cross_type_returns_hits_from_multiple_types(
    integration_client, two_type_ontology
):
    key = two_type_ontology["ontology_key"]

    await integration_client.post(f"/api/runtime/{key}/entities/person", json={
        "name": "Alice Engineer",
        "bio": "Expert in distributed systems and microservices",
    })
    await integration_client.post(f"/api/runtime/{key}/entities/company", json={
        "name": "DistribCorp",
        "industry": "Distributed systems consultancy",
    })

    resp = await integration_client.get(
        f"/api/runtime/{key}/search/semantic/entities",
        params={"q": "distributed systems", "limit": 10},
    )
    assert resp.status_code == 200, resp.text
    items = resp.json()
    type_keys = {row["_entityTypeKey"] for row in items}
    assert "person" in type_keys
    assert "company" in type_keys


async def test_score_ordering_descends(integration_client, two_type_ontology):
    key = two_type_ontology["ontology_key"]
    await integration_client.post(f"/api/runtime/{key}/entities/person", json={
        "name": "Alice",
        "bio": "Professional skydiver and base jumper",
    })
    await integration_client.post(f"/api/runtime/{key}/entities/person", json={
        "name": "Bob",
        "bio": "Distributed systems engineer building microservices at scale",
    })
    resp = await integration_client.get(
        f"/api/runtime/{key}/search/semantic/entities",
        params={"q": "distributed systems engineer", "limit": 10},
    )
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) >= 2
    scores = [row["score"] for row in items]
    assert scores == sorted(scores, reverse=True)


# ---------------------------------------------------------------------------
# Case 3: scoped ontology hides out-of-scope types
# ---------------------------------------------------------------------------


async def test_scoped_ontology_hides_out_of_scope_types(
    integration_client, two_type_ontology
):
    key = two_type_ontology["ontology_key"]
    await integration_client.post(f"/api/runtime/{key}/entities/person", json={
        "name": "Alice",
        "bio": "Software engineer",
    })
    await integration_client.post(f"/api/runtime/{key}/entities/company", json={
        "name": "Acme Software",
    })

    # Add a scoped ontology that only includes the person type.
    resp = await integration_client.post("/api/model/ontologies", json={
        "key": "people_only",
        "name": "People Only",
    })
    assert resp.status_code == 201
    scoped_ont_id = resp.json()["ontologyId"]
    resp = await integration_client.post(
        f"/api/model/ontologies/{scoped_ont_id}/includes/entity-types",
        json={"key": "person", "properties": None},
    )
    assert resp.status_code == 201, resp.text

    resp = await integration_client.get(
        "/api/runtime/people_only/search/semantic/entities",
        params={"q": "software", "limit": 10},
    )
    assert resp.status_code == 200, resp.text
    items = resp.json()
    assert items, "scoped search should still return person matches"
    for row in items:
        assert row["_entityTypeKey"] == "person"


# ---------------------------------------------------------------------------
# Case 4: group_id filter
# ---------------------------------------------------------------------------


async def test_group_id_filter_segregates_groups(integration_client, two_type_ontology):
    """Two entities live in `default` (entity write path forces _groupId='default').

    The runtime filter pushes ``$group_id`` into the Cypher WHERE, so requesting
    a non-existent group must return zero rows; requesting ``default`` must
    return matches.
    """
    key = two_type_ontology["ontology_key"]
    await integration_client.post(f"/api/runtime/{key}/entities/person", json={
        "name": "Alice",
        "bio": "Software engineer",
    })

    resp = await integration_client.get(
        f"/api/runtime/{key}/search/semantic/entities",
        params={"q": "engineer", "groupId": "missing_tenant", "limit": 10},
    )
    assert resp.status_code == 200
    assert resp.json() == []

    resp = await integration_client.get(
        f"/api/runtime/{key}/search/semantic/entities",
        params={"q": "engineer", "groupId": "default", "limit": 10},
    )
    assert resp.status_code == 200
    assert len(resp.json()) >= 1


# ---------------------------------------------------------------------------
# Case 5: min_score floor
# ---------------------------------------------------------------------------


async def test_min_score_floor_filters_low_matches(integration_client, two_type_ontology):
    key = two_type_ontology["ontology_key"]
    await integration_client.post(f"/api/runtime/{key}/entities/person", json={
        "name": "Alice",
        "bio": "Skydiver",
    })

    # Impossibly high min_score → empty
    resp = await integration_client.get(
        f"/api/runtime/{key}/search/semantic/entities",
        params={"q": "completely unrelated query", "min_score": 0.99, "limit": 10},
    )
    assert resp.status_code == 200
    assert resp.json() == []

    # Permissive min_score → at least one
    resp = await integration_client.get(
        f"/api/runtime/{key}/search/semantic/entities",
        params={"q": "skydiving", "min_score": 0.0, "limit": 10},
    )
    assert resp.status_code == 200
    assert len(resp.json()) >= 1


# ---------------------------------------------------------------------------
# Case 6: per-type endpoint regression
# ---------------------------------------------------------------------------


async def test_per_type_endpoint_still_works(integration_client, two_type_ontology):
    key = two_type_ontology["ontology_key"]
    await integration_client.post(f"/api/runtime/{key}/entities/person", json={
        "name": "Alice",
        "role": "Engineer",
    })
    resp = await integration_client.get(
        f"/api/runtime/{key}/search/semantic",
        params={"q": "engineer", "type": "person"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 1
    assert all(item["entity"]["_entityTypeKey"] == "person" for item in data["results"])


# ---------------------------------------------------------------------------
# Cases 7-8: displayName populated / null
# ---------------------------------------------------------------------------


async def test_display_name_populated_when_configured(
    integration_client, two_type_ontology_with_projection
):
    key = two_type_ontology_with_projection["ontology_key"]
    await integration_client.post(f"/api/runtime/{key}/entities/person", json={
        "name": "Alice Chen",
        "role": "Senior Engineer",
        "bio": "Distributed systems",
    })
    resp = await integration_client.get(
        f"/api/runtime/{key}/search/semantic/entities",
        params={"q": "distributed systems", "limit": 10},
    )
    assert resp.status_code == 200
    items = resp.json()
    person_row = next(r for r in items if r["_entityTypeKey"] == "person")
    assert person_row["displayName"] == "Alice Chen"


async def test_display_name_null_when_unset(integration_client, two_type_ontology):
    """No projection configured → displayName is null."""
    key = two_type_ontology["ontology_key"]
    await integration_client.post(f"/api/runtime/{key}/entities/person", json={
        "name": "Alice",
        "bio": "Engineer",
    })
    resp = await integration_client.get(
        f"/api/runtime/{key}/search/semantic/entities",
        params={"q": "engineer", "limit": 10},
    )
    assert resp.status_code == 200
    person_row = next(r for r in resp.json() if r["_entityTypeKey"] == "person")
    assert person_row["displayName"] is None


# ---------------------------------------------------------------------------
# Cases 9-10: properties projection populated / empty
# ---------------------------------------------------------------------------


async def test_properties_projection_matches_configuration(
    integration_client, two_type_ontology_with_projection
):
    key = two_type_ontology_with_projection["ontology_key"]
    await integration_client.post(f"/api/runtime/{key}/entities/person", json={
        "name": "Alice",
        "role": "Engineer",
        "bio": "Distributed systems expert",
    })
    resp = await integration_client.get(
        f"/api/runtime/{key}/search/semantic/entities",
        params={"q": "distributed systems", "limit": 10},
    )
    person_row = next(r for r in resp.json() if r["_entityTypeKey"] == "person")
    assert set(person_row["properties"].keys()) == {"role", "bio"}
    assert person_row["properties"]["role"] == "Engineer"


async def test_properties_projection_empty_when_unset(
    integration_client, two_type_ontology
):
    key = two_type_ontology["ontology_key"]
    await integration_client.post(f"/api/runtime/{key}/entities/person", json={
        "name": "Alice",
        "role": "Engineer",
    })
    resp = await integration_client.get(
        f"/api/runtime/{key}/search/semantic/entities",
        params={"q": "engineer", "limit": 10},
    )
    person_row = next(r for r in resp.json() if r["_entityTypeKey"] == "person")
    assert person_row["properties"] == {}


# ---------------------------------------------------------------------------
# Case 11: out-of-scope displayNameProperty → null displayName
# ---------------------------------------------------------------------------


async def test_out_of_scope_display_name_property_returns_null(
    integration_client, two_type_ontology
):
    """A scoped ontology that filters out the displayNameProperty's referenced
    property → displayName must come back as null per M4 §6.2.

    The unscoped ontology's person type has ``displayNameProperty="role"``
    (a non-required property so it can be legally excluded from a scope).
    The scoped ontology then includes person but only the required ``name``
    property, hiding ``role`` from the runtime — displayName must be null.
    """
    person_id = two_type_ontology["person_id"]
    key = two_type_ontology["ontology_key"]

    # Configure the displayNameProperty against a non-required property so a
    # downstream scoped ontology is allowed to omit it.
    resp = await integration_client.put(
        f"/api/model/entity-types/{person_id}",
        json={"displayNameProperty": "role"},
    )
    assert resp.status_code == 200, resp.text

    await integration_client.post(f"/api/runtime/{key}/entities/person", json={
        "name": "Alice",
        "role": "Engineer",
    })

    # Scoped ontology that includes person but only the required `name`
    # property — `role` is intentionally out-of-scope.
    resp = await integration_client.post("/api/model/ontologies", json={
        "key": "no_role_ontology",
        "name": "No Role Ontology",
    })
    assert resp.status_code == 201
    no_role_id = resp.json()["ontologyId"]
    resp = await integration_client.post(
        f"/api/model/ontologies/{no_role_id}/includes/entity-types",
        json={"key": "person", "properties": ["name"]},
    )
    assert resp.status_code == 201, resp.text

    resp = await integration_client.get(
        "/api/runtime/no_role_ontology/search/semantic/entities",
        params={"q": "engineer", "limit": 10},
    )
    assert resp.status_code == 200, resp.text
    items = resp.json()
    assert items, "scoped search should still return person matches"
    for row in items:
        assert row["displayName"] is None
