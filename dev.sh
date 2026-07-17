#!/usr/bin/env bash
set -euo pipefail

# Usage: ./dev.sh [ollama|openai] [new|legacy|both]

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PID=""
FRONTEND_PID=""
LEGACY_FRONTEND_PID=""
NEO4J_STARTED_BY_US=false

cleanup() {
    echo ""
    echo "Shutting down..."

    if [ -n "$FRONTEND_PID" ] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
        kill "$FRONTEND_PID" 2>/dev/null
        wait "$FRONTEND_PID" 2>/dev/null || true
        echo "  Frontend stopped"
    fi

    # --- legacy-ui (delete this block when frontend-legacy/ is removed) ---
    if [ -n "$LEGACY_FRONTEND_PID" ] && kill -0 "$LEGACY_FRONTEND_PID" 2>/dev/null; then
        kill "$LEGACY_FRONTEND_PID" 2>/dev/null
        wait "$LEGACY_FRONTEND_PID" 2>/dev/null || true
        echo "  Legacy frontend stopped"
    fi
    # --- end legacy-ui ---

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

# --- Embedding preset ---
EMBED_MODE="${1:-ollama}"

case "$EMBED_MODE" in
    ollama)
        export EMBEDDING_PROVIDER=ollama
        export EMBEDDING_MODEL=nomic-embed-text
        export EMBEDDING_BASE_URL=http://localhost:11434
        export EMBEDDING_DIMENSIONS=768
        ;;
    openai)
        export EMBEDDING_PROVIDER=openai
        export EMBEDDING_MODEL=nomic-embed-text
        export EMBEDDING_BASE_URL=http://localhost:11434
        export EMBEDDING_API_KEY=ollama
        export EMBEDDING_DIMENSIONS=768
        ;;
    *)
        echo "Unknown embedding mode: $EMBED_MODE (use 'ollama' or 'openai')"
        exit 1
        ;;
esac
echo "Embedding: $EMBED_MODE ($EMBEDDING_MODEL)"

# --- UI preset ---
UI_MODE="${2:-new}"

case "$UI_MODE" in
    new|legacy|both) ;;
    *)
        echo "Unknown UI mode: $UI_MODE (use 'new', 'legacy', or 'both')"
        exit 1
        ;;
esac
echo "UI: $UI_MODE"

# --- AI preset (Ollama) ---
export AI_PROVIDER="${AI_PROVIDER:-ollama}"
export AI_MODEL="${AI_MODEL:-qwen3:8b}"
export AI_BASE_URL="${AI_BASE_URL:-http://localhost:11434}"
echo "AI: $AI_PROVIDER ($AI_MODEL)"

# --- Neo4j ---
if docker compose -f "$ROOT_DIR/docker-compose.yml" ps neo4j 2>/dev/null | grep -q "running"; then
    echo "Neo4j already running"
else
    echo "Starting Neo4j..."
    docker compose -f "$ROOT_DIR/docker-compose.yml" up -d neo4j
    NEO4J_STARTED_BY_US=true

    echo -n "Waiting for Neo4j to be healthy"
    until docker compose -f "$ROOT_DIR/docker-compose.yml" ps neo4j 2>/dev/null | grep -q "healthy"; do
        echo -n "."
        sleep 2
    done
    echo " ready"
fi

# --- Backend ---
echo "Starting backend..."
cd "$ROOT_DIR/backend"
uv run uvicorn ontoforge_server.main:app --reload --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

# Wait for backend to respond
echo -n "Waiting for backend"
until curl -s -o /dev/null http://localhost:8000/docs 2>/dev/null; do
    echo -n "."
    sleep 1
done
echo " ready"

# --- Frontend ---
if [ "$UI_MODE" = "new" ] || [ "$UI_MODE" = "both" ]; then
    echo "Starting frontend..."
    cd "$ROOT_DIR/frontend"
    npm run dev &
    FRONTEND_PID=$!
fi

# --- legacy-ui (delete this block when frontend-legacy/ is removed) ---
if [ "$UI_MODE" = "legacy" ] || [ "$UI_MODE" = "both" ]; then
    echo "Starting legacy frontend..."
    cd "$ROOT_DIR/frontend-legacy"
    npm run dev -- --port 5174 &
    LEGACY_FRONTEND_PID=$!
fi
# --- end legacy-ui ---

echo ""
echo "All services running:"
if [ -n "$FRONTEND_PID" ]; then
    echo "  Frontend  http://localhost:5173"
fi
if [ -n "$LEGACY_FRONTEND_PID" ]; then
    echo "  Legacy UI http://localhost:5174"
fi
echo "  Backend   http://localhost:8000"
echo "  API docs  http://localhost:8000/docs"
echo "  Neo4j     http://localhost:7474"
echo ""
echo "Press Ctrl+C to stop all services."

wait
