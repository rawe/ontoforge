#!/usr/bin/env bash
set -euo pipefail

# Usage: ./dev.sh [ollama|openai]

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PID=""
FRONTEND_PID=""
POSTGRES_STARTED_BY_US=false

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

    if [ "$POSTGRES_STARTED_BY_US" = true ]; then
        docker compose -f "$ROOT_DIR/docker-compose.yml" stop postgres >/dev/null 2>&1
        echo "  PostgreSQL stopped"
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

# --- AI preset (Ollama) ---
export AI_PROVIDER="${AI_PROVIDER:-ollama}"
export AI_MODEL="${AI_MODEL:-qwen3:8b}"
export AI_BASE_URL="${AI_BASE_URL:-http://localhost:11434}"
echo "AI: $AI_PROVIDER ($AI_MODEL)"

# --- PostgreSQL ---
if docker compose -f "$ROOT_DIR/docker-compose.yml" ps postgres 2>/dev/null | grep -q "running"; then
    echo "PostgreSQL already running"
else
    echo "Starting PostgreSQL..."
    docker compose -f "$ROOT_DIR/docker-compose.yml" up -d postgres
    POSTGRES_STARTED_BY_US=true

    echo -n "Waiting for PostgreSQL to be healthy"
    until docker compose -f "$ROOT_DIR/docker-compose.yml" ps postgres 2>/dev/null | grep -q "healthy"; do
        echo -n "."
        sleep 2
    done
    echo " ready"
fi

# --- Backend ---
echo "Starting backend..."
cd "$ROOT_DIR/server"
[ -d node_modules ] || npm install
npm run dev &
BACKEND_PID=$!

# Wait for backend to respond
echo -n "Waiting for backend"
until curl -s -o /dev/null http://localhost:8000/docs 2>/dev/null; do
    echo -n "."
    sleep 1
done
echo " ready"

# --- Frontend ---
echo "Starting frontend..."
cd "$ROOT_DIR/frontend"
npm run dev &
FRONTEND_PID=$!

echo ""
echo "All services running:"
echo "  Frontend  http://localhost:5173"
echo "  Backend   http://localhost:8000"
echo "  API docs  http://localhost:8000/docs"
echo "  PostgreSQL localhost:5432"
echo ""
echo "Press Ctrl+C to stop all services."

wait
