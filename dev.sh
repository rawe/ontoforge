#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PID=""
FRONTEND_PID=""
NEO4J_STARTED_BY_US=false

# --- Mode selection ---
MODE="${1:-all}"
case "$MODE" in
    all)
        START_FRONTEND=true
        ;;
    backend)
        START_FRONTEND=false
        ;;
    *)
        echo "Usage: $0 [all|backend]" >&2
        echo "  all      (default) Neo4j + backend + frontend" >&2
        echo "  backend  Neo4j + backend only — pair with the Claude Preview" >&2
        echo "           launch config or run 'cd frontend && npm run dev' separately" >&2
        exit 1
        ;;
esac

cleanup() {
    echo ""
    echo "Shutting down..."

    if [ -n "$FRONTEND_PID" ] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
        kill "$FRONTEND_PID" 2>/dev/null
        wait "$FRONTEND_PID" 2>/dev/null || true
        echo "  Frontend stopped"
    fi

    if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
        kill "$BACKEND_PID" 2>/dev/null
        wait "$BACKEND_PID" 2>/dev/null || true
        echo "  Backend stopped"
    fi

    if [ "$NEO4J_STARTED_BY_US" = true ]; then
        docker compose -f "$ROOT_DIR/docker-compose.yml" stop neo4j >/dev/null 2>&1
        echo "  Neo4j stopped"
    fi

    echo "Done."
}

trap cleanup EXIT INT TERM

# --- Embedding (Ollama) ---
# EMBEDDING_MODEL and EMBEDDING_DIMENSIONS are tied to the Neo4j vector
# indexes. Do NOT change them on an existing volume — switching the model
# implies a different vector dimension, which corrupts every index. To
# change: `docker compose down -v` (drops data) and re-start.
export EMBEDDING_PROVIDER=ollama
export EMBEDDING_MODEL=nomic-embed-text
export EMBEDDING_DIMENSIONS=768
export EMBEDDING_BASE_URL=http://localhost:11434

# --- AI (Ollama) — model is freely swappable, independent of stored data ---
export AI_PROVIDER=ollama
export AI_MODEL="${AI_MODEL:-qwen3:8b}"
export AI_BASE_URL=http://localhost:11434

# --- Neo4j connection (must match docker-compose.yml) ---
export DB_URI=bolt://localhost:7687
export DB_USER=neo4j
export DB_PASSWORD=ontoforge_dev

# --- Prerequisites ---
echo "Checking prerequisites..."

if ! command -v docker >/dev/null 2>&1; then
    echo "ERROR: docker not found. Install Docker Desktop or Colima." >&2
    exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
    echo "ERROR: 'docker compose' (v2) not available. Update Docker." >&2
    exit 1
fi

if ! curl -sf "$EMBEDDING_BASE_URL/api/tags" >/dev/null 2>&1; then
    echo "ERROR: Ollama not reachable at $EMBEDDING_BASE_URL." >&2
    echo "  Start it with 'ollama serve' or launch the Ollama app." >&2
    exit 1
fi

ollama_tags="$(curl -sf "$EMBEDDING_BASE_URL/api/tags")"
for model in "$EMBEDDING_MODEL" "$AI_MODEL"; do
    if ! printf '%s' "$ollama_tags" | grep -q "\"name\":\"${model}"; then
        echo "ERROR: Ollama model '$model' is not pulled." >&2
        echo "  Pull it with: ollama pull $model" >&2
        exit 1
    fi
done

echo "  Docker available"
echo "  Ollama at $EMBEDDING_BASE_URL"
echo "  Embedding: $EMBEDDING_MODEL ($EMBEDDING_DIMENSIONS dim)"
echo "  AI:        $AI_MODEL"

# --- Neo4j ---
if docker compose -f "$ROOT_DIR/docker-compose.yml" ps neo4j 2>/dev/null | grep -q "running"; then
    echo "Neo4j already running"
else
    echo "Starting Neo4j..."
    docker compose -f "$ROOT_DIR/docker-compose.yml" up -d neo4j
    NEO4J_STARTED_BY_US=true

    echo -n "Waiting for Neo4j to be healthy"
    for _ in {1..30}; do
        if docker compose -f "$ROOT_DIR/docker-compose.yml" ps neo4j 2>/dev/null | grep -q "healthy"; then
            echo " ready"
            break
        fi
        echo -n "."
        sleep 2
    done
    if ! docker compose -f "$ROOT_DIR/docker-compose.yml" ps neo4j 2>/dev/null | grep -q "healthy"; then
        echo ""
        echo "ERROR: Neo4j did not become healthy within 60s." >&2
        exit 1
    fi
fi

# --- Backend ---
echo "Starting backend..."
cd "$ROOT_DIR/backend"
uv run uvicorn ontoforge_server.main:app --reload --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

echo -n "Waiting for backend"
for _ in {1..30}; do
    if curl -sf -o /dev/null http://localhost:8000/docs 2>/dev/null; then
        echo " ready"
        break
    fi
    echo -n "."
    sleep 1
done
if ! curl -sf -o /dev/null http://localhost:8000/docs 2>/dev/null; then
    echo ""
    echo "ERROR: backend did not respond at http://localhost:8000/docs within 30s." >&2
    exit 1
fi

# --- Frontend ---
if [ "$START_FRONTEND" = true ]; then
    echo "Starting frontend..."
    cd "$ROOT_DIR/frontend"
    npm run dev &
    FRONTEND_PID=$!
fi

echo ""
echo "Services running:"
if [ "$START_FRONTEND" = true ]; then
    echo "  Frontend  http://localhost:5173"
fi
echo "  Backend   http://localhost:8000"
echo "  API docs  http://localhost:8000/docs"
echo "  Neo4j     http://localhost:7474"
echo ""
echo "Press Ctrl+C to stop."

wait
