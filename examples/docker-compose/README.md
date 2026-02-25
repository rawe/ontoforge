# OntoForge — Docker Compose Example

Run OntoForge using pre-built container images from GHCR. Copy this folder anywhere — it has no dependencies on the rest of the repository.

## Usage

```bash
# Run latest version
docker compose up -d

# Run a specific version
VERSION=1.0.0 docker compose up -d

# Stop (data is preserved in the neo4j-data volume)
docker compose stop
```

## Services

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:8000 |
| API docs | http://localhost:8000/docs |
| Neo4j Browser | http://localhost:7474 |

## Configuration

Change the Neo4j password by replacing `changeme` in both the `neo4j` and `backend` service definitions.

See the main project README for backend environment variables.
