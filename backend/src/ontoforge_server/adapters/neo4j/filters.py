"""WHERE-clause construction for the Neo4j runtime adapter.

Turns the structured filter/search inputs that cross the persistence port
(filter dicts, search strings) into Cypher WHERE fragments plus query
parameters. Adapter-private — query fragments never leave this package.
"""

from typing import Any

from ontoforge_server.core.exceptions import ValidationError

_OPERATORS = {
    "gt": ">",
    "gte": ">=",
    "lt": "<",
    "lte": "<=",
    "contains": "CONTAINS",
}


def build_filter_clauses(
    filters: dict[str, str],
    property_defs: dict[str, Any],
    type_key: str,
    node_alias: str = "n",
) -> tuple[list[str], dict]:
    """Build WHERE fragments and parameters from a list-endpoint filter dict.

    ``property_defs`` maps property keys to definitions exposing ``data_type``
    (the scoped schema's property definitions). Raises the same
    ``ValidationError``s the service used to raise for unknown properties,
    unknown operators, and uncoercible values.
    """
    # Value coercion is shared with the service layer (which validates write
    # payloads); a later phase moves it to a neutral module.
    from ontoforge_server.runtime.service import coerce_value

    where_clauses: list[str] = []
    params: dict[str, Any] = {}

    for filter_expr, raw_value in filters.items():
        if "__" in filter_expr:
            prop_key, op_name = filter_expr.rsplit("__", 1)
        else:
            prop_key = filter_expr
            op_name = None

        prop_def = property_defs.get(prop_key)
        if not prop_def:
            raise ValidationError(
                f"Unknown filter property: '{prop_key}'",
                details={"fields": {prop_key: f"Not defined in type '{type_key}'"}},
            )

        try:
            if op_name == "contains":
                coerced_value = str(raw_value)
            else:
                coerced_value = coerce_value(raw_value, prop_def.data_type, prop_key)
        except ValueError as e:
            raise ValidationError(
                f"Invalid filter value for '{prop_key}'",
                details={"fields": {prop_key: str(e)}},
            )

        param_name = f"flt_{len(params)}"

        if op_name is None:
            where_clauses.append(f"{node_alias}.{prop_key} = ${param_name}")
        elif op_name == "contains":
            where_clauses.append(
                f"toLower(toString({node_alias}.{prop_key})) CONTAINS toLower(${param_name})"
            )
        elif op_name in _OPERATORS:
            where_clauses.append(f"{node_alias}.{prop_key} {_OPERATORS[op_name]} ${param_name}")
        else:
            raise ValidationError(
                f"Unknown filter operator: '{op_name}'",
                details={"fields": {filter_expr: f"Unsupported operator '{op_name}'"}},
            )

        params[param_name] = coerced_value

    return where_clauses, params


def build_search_clause(
    search: str,
    property_keys: list[str],
    node_alias: str = "n",
) -> tuple[str, dict]:
    """Build the case-insensitive substring search clause over string properties."""
    q_clauses = [
        f"toLower(toString({node_alias}.{prop})) CONTAINS toLower($q_search)"
        for prop in property_keys
    ]
    return f"({' OR '.join(q_clauses)})", {"q_search": search}
