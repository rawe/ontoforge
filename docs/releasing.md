# Releasing

How to release a new version of OntoForge.

## Versioning

OntoForge uses two levels of versioning:

- **System version** — the git tag (e.g., `v0.2.0`). Represents the overall OntoForge release and triggers the CI pipeline.
- **Component versions** — defined in each component's package file:
  - Backend: `version` in `backend/pyproject.toml`
  - Frontend: `version` in `frontend/package.json`

Component versions are embedded in container image labels during the build. Currently, component versions match the system version for simplicity, but they may diverge in the future as components evolve independently.

## Release Process

1. Bump component versions in `backend/pyproject.toml` and `frontend/package.json`
2. Commit the version bump
3. Tag: `git tag v{version}` (e.g., `git tag v0.2.0`)
4. Push: `git push origin main --tags`

The tag push triggers the GitHub Actions workflow (`.github/workflows/release-images.yml`), which runs `make release` to build and push container images to GHCR.

## Local Build

```bash
make release VERSION=0.2.0              # Build locally
make release VERSION=0.2.0 PUSH=true    # Build and push
```
