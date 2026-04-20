"""Fact template validation and rendering for semantic relation types.

A fact template is a constrained Jinja2 expression that renders a natural-language
sentence from a relation's context (source entity, target entity, relation user
properties). The rendered string (`_fact`) is then embedded for semantic search
over relations.

Security + scope constraints (per Phase 1 spec §4.2 / §4.3):

- Parses with a ``SandboxedEnvironment``.
- Template source ≤ 2000 chars; rendered output ≤ 2000 chars.
- ``__`` in expressions is rejected (common SSTI escape marker).
- Allowed tags: variable expansion, ``if``/``elif``/``else``/``endif``, ``set``.
  ``for``, ``include``, ``import``, ``macro``, ``call`` are disabled.
- Allowed filters: ``date``, ``default``, ``lower``, ``upper``, ``title``,
  ``join``, ``trim``.
- Every ``{source.X}`` reference must resolve to a property defined on the
  relation's source entity type; likewise for ``target`` and ``relation``.
  ``displayName`` is always permitted on all three.
"""

from __future__ import annotations

from typing import Any

from jinja2 import TemplateSyntaxError, meta, nodes
from jinja2.exceptions import UndefinedError
from jinja2.sandbox import SandboxedEnvironment

MAX_TEMPLATE_SOURCE_CHARS = 2000
MAX_RENDERED_CHARS = 2000

_ALLOWED_FILTERS = frozenset({"date", "default", "lower", "upper", "title", "join", "trim"})

_ALLOWED_ROOT_VARS = frozenset({"source", "target", "relation"})

# ``displayName`` is always available regardless of declared properties.
_ALWAYS_AVAILABLE_KEYS = frozenset({"displayName"})


def _build_env() -> SandboxedEnvironment:
    """Construct a sandboxed Jinja2 environment restricted to the filter whitelist."""
    env = SandboxedEnvironment(autoescape=False)
    # Drop every filter that isn't whitelisted.
    for name in list(env.filters):
        if name not in _ALLOWED_FILTERS:
            del env.filters[name]
    # ``date`` isn't a stock Jinja2 filter — provide a minimal safe implementation.
    if "date" not in env.filters:
        env.filters["date"] = _date_filter
    # Drop tests we haven't explicitly allowed; keep defaults (they're data-only).
    # Disable dangerous globals.
    env.globals.clear()
    return env


def _date_filter(value: Any, fmt: str = "%Y-%m-%d") -> str:
    """Minimal ``|date`` filter that formats date / datetime / ISO strings.

    Falls back to ``str(value)`` if formatting is not possible. Deliberately
    conservative — templates render against arbitrary inputs.
    """
    if value is None:
        return ""
    from datetime import date, datetime

    if isinstance(value, datetime) or isinstance(value, date):
        try:
            return value.strftime(fmt)
        except Exception:
            return str(value)
    if isinstance(value, str):
        # Try ISO parse; if it fails, return the string unchanged.
        try:
            parsed = datetime.fromisoformat(value)
            return parsed.strftime(fmt)
        except ValueError:
            return value
    return str(value)


_ENV = _build_env()


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


_DISALLOWED_TAGS = frozenset({"for", "include", "import", "from", "macro", "call"})


def _walk_nodes(node: nodes.Node):
    yield node
    for child in node.iter_child_nodes():
        yield from _walk_nodes(child)


def _collect_attribute_chain(node: nodes.Node) -> tuple[str, list[str]] | None:
    """If ``node`` is a ``foo.bar.baz`` chain rooted at a Name node, return
    (root_name, [attr1, attr2, ...]). Otherwise return None.
    """
    attrs: list[str] = []
    current: nodes.Node = node
    while isinstance(current, nodes.Getattr):
        attrs.append(current.attr)
        current = current.node
    if isinstance(current, nodes.Name):
        return current.name, list(reversed(attrs))
    return None


def validate_fact_template(
    template: str,
    source_props: set[str],
    target_props: set[str],
    relation_props: set[str],
) -> None:
    """Validate a fact template against the constrained grammar.

    Raises :class:`ValueError` on any violation.
    """
    if template is None:
        raise ValueError("Fact template must not be None")
    if not isinstance(template, str):
        raise ValueError("Fact template must be a string")
    if len(template) > MAX_TEMPLATE_SOURCE_CHARS:
        raise ValueError(
            f"Fact template source too long: {len(template)} > "
            f"{MAX_TEMPLATE_SOURCE_CHARS} characters"
        )
    if "__" in template:
        raise ValueError("Fact template must not contain '__' (reserved)")

    try:
        ast = _ENV.parse(template)
    except TemplateSyntaxError as exc:
        raise ValueError(f"Fact template parse error: {exc.message}") from exc

    # Reject disallowed block tags. Jinja parses these into specific node types.
    for node in _walk_nodes(ast):
        node_name = type(node).__name__
        if node_name in ("For", "Include", "Import", "FromImport", "Macro", "CallBlock"):
            raise ValueError(
                f"Fact template tag '{node_name.lower()}' is not allowed"
            )

    # Validate filter usage against whitelist.
    for node in _walk_nodes(ast):
        if isinstance(node, nodes.Filter):
            if node.name not in _ALLOWED_FILTERS:
                raise ValueError(
                    f"Fact template filter '{node.name}' is not allowed. "
                    f"Allowed filters: {sorted(_ALLOWED_FILTERS)}"
                )

    # Validate every referenced variable: must be rooted in source/target/relation
    # and refer to a known property or `displayName`.
    declared = meta.find_undeclared_variables(ast)
    for name in declared:
        if name not in _ALLOWED_ROOT_VARS:
            raise ValueError(
                f"Fact template references unknown variable '{name}'. "
                f"Allowed roots: {sorted(_ALLOWED_ROOT_VARS)}"
            )

    for node in _walk_nodes(ast):
        if isinstance(node, nodes.Getattr):
            chain = _collect_attribute_chain(node)
            if chain is None:
                continue
            root, attrs = chain
            if root not in _ALLOWED_ROOT_VARS:
                continue  # caught by declared-variables check above
            if not attrs:
                continue
            first = attrs[0]
            if first in _ALWAYS_AVAILABLE_KEYS:
                continue
            if root == "source" and first not in source_props:
                raise ValueError(
                    f"Fact template references unknown source property '{first}'"
                )
            if root == "target" and first not in target_props:
                raise ValueError(
                    f"Fact template references unknown target property '{first}'"
                )
            if root == "relation" and first not in relation_props:
                raise ValueError(
                    f"Fact template references unknown relation property '{first}'"
                )


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------


def render_fact(
    template: str,
    source_data: dict[str, Any],
    target_data: dict[str, Any],
    relation_data: dict[str, Any],
) -> str:
    """Render the fact template against the three contexts.

    Enforces the rendered-output size cap. Returns the rendered string. Raises
    :class:`ValueError` on failure (including size cap) so callers can fall back
    to a failed-embedding state without crashing the write path.
    """
    try:
        tmpl = _ENV.from_string(template)
    except TemplateSyntaxError as exc:
        raise ValueError(f"Fact template parse error: {exc.message}") from exc

    try:
        rendered = tmpl.render(
            source=source_data,
            target=target_data,
            relation=relation_data,
        )
    except UndefinedError as exc:
        raise ValueError(f"Fact template render error: {exc}") from exc
    except Exception as exc:  # pragma: no cover - unexpected Jinja failure
        raise ValueError(f"Fact template render error: {exc}") from exc

    if len(rendered) > MAX_RENDERED_CHARS:
        raise ValueError(
            f"Rendered fact too long: {len(rendered)} > {MAX_RENDERED_CHARS} characters"
        )
    return rendered
