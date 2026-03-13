#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "httpx",
# ]
# ///
"""Import an OntoForge ontology schema from a JSON file via the Modeling REST API."""

import argparse
import json
import os
import sys
from pathlib import Path

import httpx


def resolve_base_url(cli_value: str | None) -> str:
    if cli_value:
        return cli_value.rstrip("/")
    return os.environ.get("ONTOFORGE_BASE_URL", "http://localhost:8000").rstrip("/")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Import an OntoForge ontology schema from a JSON file.",
    )
    parser.add_argument("file", help="Path to the schema JSON file")
    parser.add_argument(
        "--base-url",
        default=None,
        help="OntoForge server URL (default: ONTOFORGE_BASE_URL or http://localhost:8000)",
    )
    args = parser.parse_args()

    schema_path = Path(args.file)
    if not schema_path.exists():
        print(f"Error: file not found: {schema_path}", file=sys.stderr)
        sys.exit(1)

    try:
        payload = json.loads(schema_path.read_text())
    except json.JSONDecodeError as e:
        print(f"Error: invalid JSON: {e}", file=sys.stderr)
        sys.exit(1)

    base_url = resolve_base_url(args.base_url)

    try:
        with httpx.Client(timeout=30) as client:
            resp = client.post(
                f"{base_url}/api/model/import",
                json=payload,
                params={"overwrite": "true"},
            )
            resp.raise_for_status()
            result = resp.json()

        print(f"{result['key']}: {result['name']}")

    except httpx.ConnectError:
        print(f"Error: cannot connect to {base_url}", file=sys.stderr)
        sys.exit(1)
    except httpx.HTTPStatusError as e:
        print(f"Error: API returned {e.response.status_code}: {e.response.text}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
