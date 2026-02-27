"""Tests for text representation builder."""

import pytest

from ontoforge_server.runtime.embedding import build_text_repr, _MAX_TEXT_CHARS
from ontoforge_server.runtime.service import PropertyDef


def _prop(key: str, data_type: str = "string", required: bool = False) -> PropertyDef:
    return PropertyDef(
        key=key,
        display_name=key.replace("_", " ").title(),
        description=None,
        data_type=data_type,
        required=required,
        default_value=None,
    )


def test_string_properties_only():
    """Only string properties are included in the text representation."""
    props = {"name": "Alice", "age": 30, "bio": "Engineer"}
    defs = {
        "name": _prop("name"),
        "age": _prop("age", data_type="integer"),
        "bio": _prop("bio"),
    }
    result = build_text_repr("person", props, defs)
    assert result == "person: name=Alice, bio=Engineer"


def test_null_values_skipped():
    """Null values are excluded from the text representation."""
    props = {"name": "Alice", "bio": None}
    defs = {
        "name": _prop("name"),
        "bio": _prop("bio"),
    }
    result = build_text_repr("person", props, defs)
    assert result == "person: name=Alice"


def test_schema_defined_order():
    """Properties appear in schema-defined order (dict order of property_defs)."""
    props = {"bio": "Engineer", "name": "Alice", "role": "Lead"}
    defs = {
        "name": _prop("name"),
        "role": _prop("role"),
        "bio": _prop("bio"),
    }
    result = build_text_repr("person", props, defs)
    assert result == "person: name=Alice, role=Lead, bio=Engineer"


def test_empty_properties():
    """No string properties results in just the entity type key."""
    props = {"count": 5}
    defs = {
        "count": _prop("count", data_type="integer"),
    }
    result = build_text_repr("counter", props, defs)
    assert result == "counter"


def test_no_properties():
    """Empty properties dict results in just the entity type key."""
    result = build_text_repr("empty_type", {}, {})
    assert result == "empty_type"


def test_mixed_types():
    """Only string properties are included; integer, float, boolean are excluded."""
    props = {"name": "Bob", "age": 25, "score": 9.5, "active": True, "email": "bob@test.com"}
    defs = {
        "name": _prop("name"),
        "age": _prop("age", data_type="integer"),
        "score": _prop("score", data_type="float"),
        "active": _prop("active", data_type="boolean"),
        "email": _prop("email"),
    }
    result = build_text_repr("person", props, defs)
    assert result == "person: name=Bob, email=bob@test.com"


def test_truncation():
    """Long text representations are truncated at the char limit."""
    long_value = "x" * (_MAX_TEXT_CHARS + 1000)
    props = {"content": long_value}
    defs = {"content": _prop("content")}

    result = build_text_repr("doc", props, defs)
    assert len(result) == _MAX_TEXT_CHARS
