from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ontoforge_server.runtime.service import PropertyDef

logger = logging.getLogger(__name__)

# nomic-embed-text has 8192 token limit; ~4 chars/token → 30000 chars as safe threshold
_MAX_TEXT_CHARS = 30000


def build_text_repr(
    entity_type_key: str,
    properties: dict,
    property_defs: dict[str, PropertyDef],
) -> str:
    """Build a text representation of an entity for embedding.

    Format: "{entity_type_key}: {key}={value}, {key}={value}, ..."
    Only includes string properties with non-null values, in schema-defined order.
    """
    parts: list[str] = []
    for prop_key, prop_def in property_defs.items():
        if prop_def.data_type != "string":
            continue
        value = properties.get(prop_key)
        if value is not None:
            parts.append(f"{prop_key}={value}")

    text = f"{entity_type_key}: {', '.join(parts)}" if parts else entity_type_key

    if len(text) > _MAX_TEXT_CHARS:
        logger.warning(
            "Text representation for entity type '%s' truncated from %d to %d chars",
            entity_type_key,
            len(text),
            _MAX_TEXT_CHARS,
        )
        text = text[:_MAX_TEXT_CHARS]

    return text
