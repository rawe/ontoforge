"""CLI tool to provision an ontology from the modeling server to the runtime server."""

import argparse
import sys

import httpx


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Provision an ontology from the modeling server to the runtime server.",
    )
    parser.add_argument(
        "--model-url",
        default="http://localhost:8000",
        help="Base URL of the modeling server (default: http://localhost:8000)",
    )
    parser.add_argument(
        "--runtime-url",
        default="http://localhost:8001",
        help="Base URL of the runtime server (default: http://localhost:8001)",
    )
    parser.add_argument(
        "--ontology",
        required=True,
        help="Ontology ID to export and provision",
    )
    args = parser.parse_args()

    export_url = f"{args.model_url}/api/model/ontologies/{args.ontology}/export"
    provision_url = f"{args.runtime_url}/api/provision"

    print(f"Exporting ontology '{args.ontology}' from {args.model_url} ...")

    try:
        with httpx.Client(timeout=30.0) as client:
            # Step 1: Export from modeling server
            export_resp = client.get(export_url)
            if export_resp.status_code != 200:
                print(
                    f"Error: Export failed with status {export_resp.status_code}",
                    file=sys.stderr,
                )
                print(f"  Response: {export_resp.text}", file=sys.stderr)
                sys.exit(1)

            payload = export_resp.json()
            entity_count = len(payload.get("entityTypes", []))
            relation_count = len(payload.get("relationTypes", []))
            print(
                f"  Exported: {entity_count} entity type(s), "
                f"{relation_count} relation type(s)"
            )

            # Step 2: Provision to runtime server
            print(f"Provisioning to {args.runtime_url} ...")
            provision_resp = client.post(provision_url, json=payload)
            if provision_resp.status_code not in (200, 201):
                print(
                    f"Error: Provisioning failed with status {provision_resp.status_code}",
                    file=sys.stderr,
                )
                print(f"  Response: {provision_resp.text}", file=sys.stderr)
                sys.exit(1)

            result = provision_resp.json()
            print("Provisioning complete.")
            print(f"  Result: {result}")

    except httpx.ConnectError as exc:
        print(f"Error: Could not connect - {exc}", file=sys.stderr)
        sys.exit(1)
    except httpx.TimeoutException:
        print("Error: Request timed out", file=sys.stderr)
        sys.exit(1)
    except httpx.HTTPError as exc:
        print(f"Error: HTTP error - {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
