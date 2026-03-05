#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "httpx",
#     "python-slugify",
# ]
# ///
"""Export an OntoForge ontology to structured JSON files via the Runtime REST API."""

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

import httpx
from slugify import slugify

# Property names checked in order to find a human-readable slug for filenames.
# First match (present in schema AND non-empty on the entity) wins.
# Fallback: the entity's _id (UUID).
SLUG_CANDIDATES = ["key", "name", "title", "label", "display_name", "displayName"]

# System/metadata fields stripped from exported entity and relation data.
SYSTEM_FIELDS = {"_id", "_entityTypeKey", "_relationTypeKey", "_createdAt", "_updatedAt"}


# ---------------------------------------------------------------------------
# API helpers
# ---------------------------------------------------------------------------

def fetch_schema(client: httpx.Client, api_base: str) -> dict:
    resp = client.get(f"{api_base}/schema")
    resp.raise_for_status()
    return resp.json()


def list_all(client: httpx.Client, url: str, params: dict | None = None) -> list[dict]:
    """Paginate through all items from a list endpoint (max page size 200)."""
    params = dict(params or {})
    params.setdefault("limit", 200)
    params["offset"] = 0
    all_items: list[dict] = []
    while True:
        resp = client.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()
        all_items.extend(data["items"])
        if len(all_items) >= data["total"]:
            break
        params["offset"] += params["limit"]
    return all_items


# ---------------------------------------------------------------------------
# Naming helpers
# ---------------------------------------------------------------------------

def find_slug_property(entity_type: dict) -> str | None:
    """Determine which property to use for filenames based on SLUG_CANDIDATES order."""
    prop_keys = {p["key"] for p in entity_type["properties"]}
    for candidate in SLUG_CANDIDATES:
        if candidate in prop_keys:
            return candidate
    return None


def make_filename(entity: dict, slug_prop: str | None, seen: set[str]) -> str:
    """Generate a unique slugified filename (without extension) for an entity."""
    raw = None
    if slug_prop and slug_prop in entity and entity[slug_prop]:
        raw = str(entity[slug_prop])

    if raw:
        base = slugify(raw, max_length=80)
    else:
        base = entity["_id"]

    # Ensure uniqueness within the same entity-type folder
    filename = base
    counter = 2
    while filename in seen:
        filename = f"{base}-{counter}"
        counter += 1
    seen.add(filename)
    return filename


def strip_system_fields(data: dict) -> dict:
    return {k: v for k, v in data.items() if k not in SYSTEM_FIELDS}


# ---------------------------------------------------------------------------
# Export logic
# ---------------------------------------------------------------------------

def export_ontology(base_url: str, ontology_key: str, output_dir: Path) -> None:
    api_base = f"{base_url.rstrip('/')}/api/runtime/{ontology_key}"
    timestamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    export_dir = output_dir / f"data_{ontology_key}_{timestamp}"

    with httpx.Client(timeout=30) as client:
        # ── Schema ─────────────────────────────────────────────────────
        print(f"Fetching schema from {api_base}/schema ...")
        schema = fetch_schema(client, api_base)

        ontology_name = schema["ontology"].get("name", ontology_key)
        entity_types = schema["entityTypes"]
        relation_types = schema["relationTypes"]

        print(f"Ontology: {ontology_name}")
        print(f"Entity types: {', '.join(et['key'] for et in entity_types)}")
        print(f"Relation types: {', '.join(rt['key'] for rt in relation_types)}")

        # ── Export schema ──────────────────────────────────────────
        export_dir.mkdir(parents=True, exist_ok=True)
        schema_path = export_dir / f"{ontology_key}_schema.json"
        schema_path.write_text(
            json.dumps(schema, indent=2, ensure_ascii=False) + "\n"
        )
        print(f"\nSchema exported: {schema_path.name}")

        # Determine slug property per entity type
        slug_props: dict[str, str | None] = {}
        for et in entity_types:
            slug_props[et["key"]] = find_slug_property(et)
            source = slug_props[et["key"]] or "_id (fallback)"
            print(f"  {et['key']}: filename from '{source}'")

        # ── Phase 1: Export entities ───────────────────────────────────
        # Maps entity UUID → {"type": entity_type_key, "file": filename_without_ext}
        id_to_file: dict[str, dict[str, str]] = {}

        for et in entity_types:
            et_key = et["key"]
            et_dir = export_dir / et_key
            et_dir.mkdir(parents=True, exist_ok=True)

            entities = list_all(client, f"{api_base}/entities/{et_key}")
            print(f"\nExporting {len(entities)} {et_key} entities ...")

            seen: set[str] = set()
            for entity in entities:
                filename = make_filename(entity, slug_props[et_key], seen)
                id_to_file[entity["_id"]] = {"type": et_key, "file": filename}

                clean = strip_system_fields(entity)
                filepath = et_dir / f"{filename}.json"
                filepath.write_text(
                    json.dumps(clean, indent=2, ensure_ascii=False) + "\n"
                )
                print(f"  {filepath.name}")

        # ── Phase 2: Export relations ──────────────────────────────────
        relations_dir = export_dir / "relations"
        relations_dir.mkdir(parents=True, exist_ok=True)

        for rt in relation_types:
            rt_key = rt["key"]
            relations = list_all(client, f"{api_base}/relations/{rt_key}")

            if not relations:
                print(f"\nSkipping {rt_key} (0 relations)")
                continue

            print(f"\nExporting {len(relations)} {rt_key} relations ...")

            exported: list[dict] = []
            for rel in relations:
                from_ref = id_to_file.get(rel["fromEntityId"])
                to_ref = id_to_file.get(rel["toEntityId"])

                if not from_ref or not to_ref:
                    print(f"  WARNING: unresolved reference in relation {rel['_id']}, skipping")
                    continue

                entry: dict = {
                    "from": {"type": from_ref["type"], "file": from_ref["file"]},
                    "to": {"type": to_ref["type"], "file": to_ref["file"]},
                }

                # Include any custom properties defined on the relation
                custom = {
                    k: v
                    for k, v in rel.items()
                    if k not in SYSTEM_FIELDS and k not in ("fromEntityId", "toEntityId")
                }
                if custom:
                    entry["properties"] = custom

                exported.append(entry)

            filepath = relations_dir / f"{rt_key}.json"
            filepath.write_text(
                json.dumps(exported, indent=2, ensure_ascii=False) + "\n"
            )
            print(f"  {filepath.name} ({len(exported)} entries)")

    print(f"\nExport complete: {export_dir}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Export an OntoForge ontology to structured JSON files.",
    )
    parser.add_argument("ontology_key", help="Ontology key (e.g. wacker_pi_planning)")
    parser.add_argument(
        "-o", "--output",
        required=True,
        help="Parent directory for the export (must exist). A timestamped subfolder is created inside.",
    )
    parser.add_argument(
        "--base-url",
        default=os.environ.get("ONTOFORGE_BASE_URL", "http://localhost:8000"),
        help="OntoForge server base URL (default: http://localhost:8000)",
    )
    args = parser.parse_args()

    output_dir = Path(args.output)
    if not output_dir.exists():
        print(f"Error: output directory does not exist: {output_dir}", file=sys.stderr)
        sys.exit(1)

    try:
        export_ontology(args.base_url, args.ontology_key, output_dir)
    except httpx.ConnectError:
        print(f"Error: cannot connect to {args.base_url}", file=sys.stderr)
        sys.exit(1)
    except httpx.HTTPStatusError as e:
        print(f"Error: API returned {e.response.status_code}: {e.response.text}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
