#!/usr/bin/env bash
set -euo pipefail

# Usage: ./dev.sh [env-file]      (default: server/.env)
#        ./dev.sh scale …         (shared-state harness, see below)
#
# The named file is the whole configuration for this run. Presets live in
# env/ — e.g. ./dev.sh env/ollama.env

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- Shared-state harness ----------------------------------------------------
# ./dev.sh scale up [env-file] | down | reset | logs [service…] | test [scenario…]
#               | bench [options] | status
#
# Drives the Compose project in docker/scale/compose.yml and the scripts in
# scripts/scale/ (see scripts/scale/USAGE.md). The backends' configuration is
# one env file, env/scale.env unless `up` names another preset.
if [ "${1:-}" = "scale" ]; then
    SCALE=(docker compose -f "$ROOT_DIR/docker/scale/compose.yml")
    case "${2:-}" in
        up)
            if [ -n "${3:-}" ]; then
                if [ ! -f "$3" ]; then
                    echo "Config file not found: $3"
                    exit 1
                fi
                SCALE_ENV_FILE="$(cd "$(dirname "$3")" && pwd)/$(basename "$3")"
                export SCALE_ENV_FILE
            fi
            "${SCALE[@]}" up -d --build --wait --wait-timeout 300
            node "$ROOT_DIR/scripts/scale/ready.mjs" --wait 60
            ;;
        down)   "${SCALE[@]}" --profile ui down --remove-orphans ;;
        reset)  "${SCALE[@]}" --profile ui down --volumes --remove-orphans ;;
        logs)   "${SCALE[@]}" logs -f --tail 100 "${@:3}" ;;
        test)   node "$ROOT_DIR/scripts/scale/scenarios.mjs" "${@:3}" ;;
        bench)  node "$ROOT_DIR/scripts/scale/bench.mjs" "${@:3}" ;;
        status)
            "${SCALE[@]}" ps
            node "$ROOT_DIR/scripts/scale/ready.mjs"
            ;;
        *)
            echo "Usage: ./dev.sh scale up [env-file] | down | reset | logs [service…]"
            echo "                      | test [scenario…] | bench [options] | status"
            exit 1
            ;;
    esac
    exit 0
fi

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

# --- Configuration ---------------------------------------------------------
# One file provides the whole configuration; the server reads it and nothing
# else (server/src/config.ts honours ENV_FILE). A variable already set in your
# shell still wins, so `AI_MODEL=x ./dev.sh` works.
ENV_FILE_ARG="${1:-$ROOT_DIR/server/.env}"

if [ ! -f "$ENV_FILE_ARG" ]; then
    echo "Config file not found: $ENV_FILE_ARG"
    echo ""
    echo "Presets:"
    for preset in "$ROOT_DIR"/env/*.env; do
        [ -f "$preset" ] && echo "  ./dev.sh env/$(basename "$preset")"
    done
    echo ""
    echo "Or copy server/.env.example to server/.env and run ./dev.sh with no argument."
    exit 1
fi

# Absolute, so the path stays valid after this script changes directory.
ENV_FILE="$(cd "$(dirname "$ENV_FILE_ARG")" && pwd)/$(basename "$ENV_FILE_ARG")"
export ENV_FILE

echo "Config: $ENV_FILE"
grep -E '^(DB_BACKEND|EMBEDDING_PROVIDER|AI_PROVIDER|AI_MODEL|AI_REASONING_EFFORT)=' \
    "$ENV_FILE" | sed 's|^|  |' || true

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
