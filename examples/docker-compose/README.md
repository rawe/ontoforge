# OntoForge — Docker Compose Example

Run OntoForge using pre-built container images from GHCR. Copy this folder anywhere — it has no dependencies on the rest of the repository.

## Usage

```bash
# Run latest version
docker compose up -d

# Run a specific version
VERSION=1.0.0 docker compose up -d

# Stop (data is preserved in the postgres-data volume)
docker compose stop
```

## Services

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| Server API | http://localhost:8000 |
| API docs | http://localhost:8000/docs |

Port 8000 is published as is, probes and `/metrics` included; for local use only. A public
deployment puts an ingress in front that routes only the public paths
([interfaces](../../docs/interfaces/server.md#exposure)).

## Configuration

Change the database password by replacing `changeme` in both the `postgres` and `ontoforge-server` service definitions.

See the main project README for server environment variables.
