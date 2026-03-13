from datetime import datetime, timezone

import pytest

NOW = datetime(2025, 1, 1, 12, 0, 0, tzinfo=timezone.utc)

REPO = "ontoforge_server.runtime.service.repository"
EMBEDDING = "ontoforge_server.runtime.service.get_embedding_provider"


def _make_full_schema(
    *,
    ontology_key: str = "hr_view",
    ontology_name: str = "HR View",
    entity_inclusions: list | None = None,
    relation_inclusions: list | None = None,
) -> dict:
    """Build a full schema dict as returned by repository.get_full_schema.

    When entity_inclusions / relation_inclusions are provided the schema
    represents a *scoped* ontology view.  When both are empty lists (or
    omitted) the schema is fully unscoped.
    """
    return {
        "ontology": {
            "ontologyId": "ont-1",
            "key": ontology_key,
            "name": ontology_name,
            "description": None,
            "createdAt": NOW,
            "updatedAt": NOW,
        },
        "entityTypes": [
            {
                "entityTypeId": "et-1",
                "key": "person",
                "displayName": "Person",
                "description": None,
                "properties": [
                    {"key": "name", "displayName": "Name", "dataType": "string", "required": True, "defaultValue": None},
                    {"key": "age", "displayName": "Age", "dataType": "integer", "required": False, "defaultValue": None},
                    {"key": "email", "displayName": "Email", "dataType": "string", "required": False, "defaultValue": None},
                    {"key": "active", "displayName": "Active", "dataType": "boolean", "required": False, "defaultValue": "true"},
                ],
            },
            {
                "entityTypeId": "et-2",
                "key": "company",
                "displayName": "Company",
                "description": None,
                "properties": [
                    {"key": "name", "displayName": "Name", "dataType": "string", "required": True, "defaultValue": None},
                ],
            },
            {
                "entityTypeId": "et-3",
                "key": "department",
                "displayName": "Department",
                "description": None,
                "properties": [
                    {"key": "name", "displayName": "Name", "dataType": "string", "required": True, "defaultValue": None},
                    {"key": "code", "displayName": "Code", "dataType": "string", "required": False, "defaultValue": None},
                ],
            },
        ],
        "relationTypes": [
            {
                "relationTypeId": "rt-1",
                "key": "works_for",
                "displayName": "Works For",
                "description": None,
                "sourceKey": "person",
                "targetKey": "company",
                "properties": [
                    {"key": "role", "displayName": "Role", "dataType": "string", "required": False, "defaultValue": None},
                    {"key": "since", "displayName": "Since", "dataType": "date", "required": False, "defaultValue": None},
                ],
            },
            {
                "relationTypeId": "rt-2",
                "key": "belongs_to",
                "displayName": "Belongs To",
                "description": None,
                "sourceKey": "department",
                "targetKey": "company",
                "properties": [],
            },
        ],
        "entityInclusions": entity_inclusions if entity_inclusions is not None else [],
        "relationInclusions": relation_inclusions if relation_inclusions is not None else [],
    }


@pytest.fixture
def scoped_schema():
    """Schema for a scoped ontology view (hr_view).

    person: only name and email visible (age and active hidden)
    company: all properties visible
    department: NOT included at all
    works_for: all properties visible
    belongs_to: NOT included (department is excluded)
    """
    return _make_full_schema(
        ontology_key="hr_view",
        ontology_name="HR View",
        entity_inclusions=[
            {"key": "person", "properties": ["name", "email"]},
            {"key": "company", "properties": None},
        ],
        relation_inclusions=[
            {"key": "works_for", "properties": None},
        ],
    )


@pytest.fixture
def unscoped_schema():
    """Schema for a fully unscoped ontology (all types/properties visible)."""
    return _make_full_schema(
        ontology_key="full_ontology",
        ontology_name="Full Ontology",
        entity_inclusions=[],
        relation_inclusions=[],
    )


def make_entity(
    entity_type_key: str = "person",
    entity_id: str = "ent-1",
    **user_props,
) -> dict:
    """Build a raw entity dict as returned by the repository layer."""
    base = {
        "_id": entity_id,
        "_entityTypeKey": entity_type_key,
        "_createdAt": NOW,
        "_updatedAt": NOW,
    }
    base.update(user_props)
    return base


def make_relation(
    relation_type_key: str = "works_for",
    relation_id: str = "rel-1",
    from_entity_id: str = "ent-1",
    to_entity_id: str = "ent-2",
    **user_props,
) -> dict:
    """Build a raw relation dict as returned by the repository layer."""
    base = {
        "_id": relation_id,
        "_relationTypeKey": relation_type_key,
        "_createdAt": NOW,
        "_updatedAt": NOW,
        "fromEntityId": from_entity_id,
        "toEntityId": to_entity_id,
    }
    base.update(user_props)
    return base
