import pytest

from ontoforge_server.core.database import (
    MAX_VECTOR_FILTER_VALUE_BYTES,
    validate_vector_indexed_properties,
)
from ontoforge_server.core.exceptions import ValidationError


def test_validate_vector_indexed_properties_accepts_short_strings():
    validate_vector_indexed_properties(
        "section",
        {"heading": "Short text", "order": 1},
        ["heading", "order"],
        entity_id="ent-1",
    )


def test_validate_vector_indexed_properties_rejects_utf8_byte_overflow():
    oversized = "x" * (MAX_VECTOR_FILTER_VALUE_BYTES + 1)

    with pytest.raises(ValidationError, match="Property 'content' on entity 'ent-1' is too large"):
        validate_vector_indexed_properties(
            "section",
            {"content": oversized},
            ["content"],
            entity_id="ent-1",
        )
