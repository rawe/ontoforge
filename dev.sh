#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PID=""
FRONTEND_PID=""
NEO4J_STARTED_BY_US=false

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
EMBEDDING_PROVIDER=ollama \
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
echo "Starting frontend..."
cd "$ROOT_DIR/frontend"
npm run dev &
FRONTEND_PID=$!

echo ""
echo "All services running:"
echo "  Frontend  http://localhost:5173"
echo "  Backend   http://localhost:8000"
echo "  API docs  http://localhost:8000/docs"
echo "  Neo4j     http://localhost:7474"
echo ""
echo "Press Ctrl+C to stop all services."

wait
