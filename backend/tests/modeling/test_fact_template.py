"""Unit tests for the fact template validator and renderer."""

import pytest

from ontoforge_server.modeling.fact_template import (
    MAX_RENDERED_CHARS,
    MAX_TEMPLATE_SOURCE_CHARS,
    render_fact,
    validate_fact_template,
)


# ---------------------------------------------------------------------------
# validate_fact_template
# ---------------------------------------------------------------------------


def test_validate_simple_template_ok():
    validate_fact_template(
        "{{ source.displayName }} works for {{ target.displayName }}",
        source_props={"name"},
        target_props={"name"},
        relation_props=set(),
    )


def test_validate_allows_whitelisted_filters():
    validate_fact_template(
        "{{ source.name | upper }} — {{ relation.tags | join(', ') }}",
        source_props={"name"},
        target_props=set(),
        relation_props={"tags"},
    )


def test_validate_rejects_unknown_filter():
    with pytest.raises(ValueError, match="filter 'safe' is not allowed"):
        validate_fact_template(
            "{{ source.name | safe }}",
            source_props={"name"},
            target_props=set(),
            relation_props=set(),
        )


def test_validate_rejects_for_tag():
    with pytest.raises(ValueError, match="tag 'for' is not allowed"):
        validate_fact_template(
            "{% for x in source %}{{ x }}{% endfor %}",
            source_props={"name"},
            target_props=set(),
            relation_props=set(),
        )


def test_validate_rejects_include_tag():
    with pytest.raises(ValueError):
        validate_fact_template(
            "{% include 'other.txt' %}",
            source_props=set(),
            target_props=set(),
            relation_props=set(),
        )


def test_validate_rejects_double_underscore():
    with pytest.raises(ValueError, match="must not contain '__'"):
        validate_fact_template(
            "{{ source.__class__ }}",
            source_props={"name"},
            target_props=set(),
            relation_props=set(),
        )


def test_validate_rejects_unknown_source_property():
    with pytest.raises(ValueError, match="unknown source property 'nope'"):
        validate_fact_template(
            "{{ source.nope }}",
            source_props={"name"},
            target_props=set(),
            relation_props=set(),
        )


def test_validate_rejects_unknown_target_property():
    with pytest.raises(ValueError, match="unknown target property"):
        validate_fact_template(
            "{{ target.unknown }}",
            source_props=set(),
            target_props={"name"},
            relation_props=set(),
        )


def test_validate_rejects_unknown_relation_property():
    with pytest.raises(ValueError, match="unknown relation property"):
        validate_fact_template(
            "{{ relation.unknown }}",
            source_props=set(),
            target_props=set(),
            relation_props={"since"},
        )


def test_validate_rejects_unknown_root_variable():
    with pytest.raises(ValueError, match="unknown variable 'context'"):
        validate_fact_template(
            "{{ context.foo }}",
            source_props=set(),
            target_props=set(),
            relation_props=set(),
        )


def test_validate_displayname_always_allowed():
    # displayName should be allowed on source/target/relation even when not
    # declared as a property.
    validate_fact_template(
        "{{ source.displayName }} {{ target.displayName }} {{ relation.displayName }}",
        source_props=set(),
        target_props=set(),
        relation_props=set(),
    )


def test_validate_rejects_oversize_template():
    big = "a" * (MAX_TEMPLATE_SOURCE_CHARS + 1)
    with pytest.raises(ValueError, match="template source too long"):
        validate_fact_template(
            big, source_props=set(), target_props=set(), relation_props=set()
        )


def test_validate_allows_if_elif_else_set():
    validate_fact_template(
        "{% set role = relation.role %}"
        "{% if role %}{{ source.displayName }} is {{ role }}"
        "{% elif relation.status %}{{ relation.status }}"
        "{% else %}unknown{% endif %}",
        source_props=set(),
        target_props=set(),
        relation_props={"role", "status"},
    )


def test_validate_rejects_syntax_error():
    with pytest.raises(ValueError, match="parse error"):
        validate_fact_template(
            "{{ source.name",
            source_props={"name"},
            target_props=set(),
            relation_props=set(),
        )


# ---------------------------------------------------------------------------
# render_fact
# ---------------------------------------------------------------------------


def test_render_simple_substitution():
    out = render_fact(
        "{{ source.displayName }} works for {{ target.displayName }}",
        source_data={"displayName": "Alice"},
        target_data={"displayName": "Acme"},
        relation_data={},
    )
    assert out == "Alice works for Acme"


def test_render_with_if_else():
    out = render_fact(
        "{% if relation.role %}{{ source.displayName }} is {{ relation.role }}"
        "{% else %}{{ source.displayName }} has no role{% endif %}",
        source_data={"displayName": "Bob"},
        target_data={},
        relation_data={"role": "Manager"},
    )
    assert out == "Bob is Manager"


def test_render_upper_filter():
    out = render_fact(
        "{{ source.name | upper }}",
        source_data={"name": "alice"},
        target_data={},
        relation_data={},
    )
    assert out == "ALICE"


def test_render_enforces_output_size_cap():
    template = "{{ relation.big }}"
    with pytest.raises(ValueError, match="Rendered fact too long"):
        render_fact(
            template,
            source_data={},
            target_data={},
            relation_data={"big": "x" * (MAX_RENDERED_CHARS + 1)},
        )


def test_render_handles_missing_attribute():
    # Undefined access yields empty string (Jinja default).
    out = render_fact(
        "{{ relation.maybe }}",
        source_data={},
        target_data={},
        relation_data={},
    )
    assert out == ""
