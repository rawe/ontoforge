# Backend retirement checklist

Executes the user's decision to retire `backend/`. Work through top to bottom;
each block is one commit-sized chunk. Nothing here is started without the user's go.

## 1. Docs fold-in (the six approved divergences → three edits)

- [ ] `docs/architecture.md` → invariants bullet "Type and property keys match …":
      delete the "**Import does not re-check the pattern**" wart (the `_id`-overwrite
      scenario + "a reimplementation should validate keys on the import path too").
      Import now enforces the same patterns as the interactive paths.
- [ ] `docs/architecture.md` → "Error model": delete the paragraph "This is not
      applied uniformly: an AI request … carrying no `details.code`." AI routes now
      answer `details.code: FEATURE_DISABLED` like semantic search.
- [ ] `docs/capabilities/transfer.md` → "Import is not atomic" bullet: replace with
      validate-then-write semantics (whole payload validated first, all conflicts and
      violations reported together, nothing written on rejection; only residual risk
      is a crash mid-write). Remove the "delete what landed, retry" recovery text.
- [ ] Divergences #3 (envelope 422), #5 (envelope 404), #6 (chat keeps system
      prompt): no docs edits needed — docs already state the TS behavior.

## 2. Delete the Python backend

- [ ] Delete `backend/` (includes `backend/Dockerfile`, `backend/.env`,
      `backend/scripts/bench.md`). Decide first: port or drop the bench script.
- [ ] `scripts/export_ontology.py` + `scripts/USAGE.md`: REST-based, works against
      the TS server — keep, but it runs via `uv`; decide whether to keep uv for
      standalone scripts or port to node.

## 3. Root documentation

- [ ] `README.md` → "Development Setup" / "Start the Backend": `cd backend && uv …`
      → `cd server && npm install && npm run dev` (or point to `server/README.md`).
      Check remaining "backend" wording; MCP/config sections are URL-based and fine.
- [ ] `CLAUDE.md`: project structure (Backend — Python → Server — TypeScript);
      delete or reduce the "Python: uv (NOT pip)" section (only `scripts/` remains
      Python, if kept); "Local Development Setup" uvicorn line → npm; check the
      workflows table links still hold.
- [ ] `server/README.md`: drop the "drop-in replacement for the Python backend"
      sentence once `backend/` is gone.

## 4. Dev tooling

- [ ] `dev.sh` (lines ~84–107): start the TS server (`cd server && npm run dev`)
      instead of uvicorn; keep the same readiness check on :8000/docs.
- [ ] `.claude/launch.json`: update any backend launch entries.

## 5. Docker + compose

- [ ] Write `server/Dockerfile` (multi-stage Node ≥22: npm ci → build → slim
      runtime running `node dist/main.js`; mirror the layer-caching pattern of the
      old backend Dockerfile — dependency files copied before source).
- [ ] `Makefile`: `release-server` — build context `backend` → `server`,
      `-f server/Dockerfile`; `SERVER_VERSION` source `backend/pyproject.toml` →
      `server/package.json`.
- [ ] `docker/docker-compose.yml`: `backend: build: ../backend` → `../server`;
      rename service/container if desired (frontend's `BACKEND_URL` must match).
- [ ] Root `docker-compose.yml`: Neo4j-only — no change (verify).
- [ ] `examples/docker-compose/docker-compose.yml` and
      `plugins/ontoforge/skills/ontoforge-setup/templates/docker-compose.yml`:
      use `ghcr.io/rawe/ontoforge-server` images — unchanged IF the image name and
      port stay; verify env var names still match `server/.env.example`.

## 6. CI (GitHub workflows)

- [ ] `.github/workflows/release-images.yml`: tag-triggered, builds via
      `make release` — works unchanged once the Makefile/Dockerfile point at
      `server/`; verify buildx multi-arch works for the Node image.
- [ ] ADD a CI workflow (push/PR): `cd server && npm ci && npm run typecheck &&
      npm test` + docker build of `server/Dockerfile` (no push); optionally a
      Neo4j service container for `npm run test:integration`.
- [ ] Frontend: `npm run build` + `npm run lint` in the same or a second job.

## 7. Final cleanup

- [ ] `docs/workflows/testing.md`: pytest commands → the four vitest suites
      (`npm test`, `test:integration`, `test:integration:embedding`,
      `test:integration:ai`) with their prerequisites.
- [ ] `docs/workflows/test-cycle.md`: agent instructions reference backend/pytest —
      update commands and paths.
- [ ] `docs/workflows/releasing.md`: version bump location `backend/pyproject.toml`
      → `server/package.json`; re-check the release steps end to end.
- [ ] Grep the repo for leftover `uvicorn|pyproject|uv run|backend/` references
      (excluding git history) and sweep.
- [ ] Delete `ts-migration/` (plan docs are deleted when done — including this file).
