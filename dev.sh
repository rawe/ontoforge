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
# Root Compose services this run started, stopped again on exit.
STARTED_SERVICES=()

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

    for service in ${STARTED_SERVICES[@]+"${STARTED_SERVICES[@]}"}; do
        docker compose -f "$ROOT_DIR/docker-compose.yml" stop "$service" >/dev/null 2>&1
        echo "  $service stopped"
    done

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

# A variable's value for this run: the shell's, else the env file's.
setting() {
    if [ -n "${!1:-}" ]; then
        echo "${!1}"
    else
        grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true
    fi
}

# Start a root Compose service unless it runs, and wait until it is healthy.
start_service() {
    if docker compose -f "$ROOT_DIR/docker-compose.yml" ps --status running --services 2>/dev/null | grep -qx "$1"; then
        echo "$1 already running"
        return
    fi
    echo "Starting $1..."
    docker compose -f "$ROOT_DIR/docker-compose.yml" up -d "$1"
    STARTED_SERVICES+=("$1")
    echo -n "Waiting for $1 to be healthy"
    until docker compose -f "$ROOT_DIR/docker-compose.yml" ps "$1" 2>/dev/null | grep -q "healthy"; do
        echo -n "."
        sleep 2
    done
    echo " ready"
}

# --- PostgreSQL and Valkey ---
# Each only when the run uses it: another DB_URI or VALKEY_URL (the scale
# harness's, say) leaves the dev container alone. Memory stays the default
# shared state; SHARED_STATE=valkey with VALKEY_URL=redis://localhost:6379
# uses this Valkey.
DB_URI_RUN="$(setting DB_URI)"
VALKEY_URL_RUN="$(setting VALKEY_URL)"
SERVICES_LINE=""
if [ -z "$DB_URI_RUN" ] || [[ "$DB_URI_RUN" == *":5432/"* ]]; then
    start_service postgres
    SERVICES_LINE+="  PostgreSQL localhost:5432"$'\n'
fi
if [ -z "$VALKEY_URL_RUN" ] || [[ "$VALKEY_URL_RUN" == *":6379"* ]]; then
    start_service valkey
    SERVICES_LINE+="  Valkey    localhost:6379"$'\n'
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
printf "%s" "$SERVICES_LINE"
echo ""
echo "Press Ctrl+C to stop all services."

wait
