# Releasing

How to release a new version of OntoForge.

## Versioning

OntoForge uses two levels of versioning:

- **System version** — the git tag (e.g., `v0.2.0`). Represents the overall OntoForge release and triggers the CI pipeline.
- **Component versions** — defined in each component's package file:
  - Backend: `version` in `server/package.json`
  - Frontend: `version` in `frontend/package.json`

Component versions are embedded in container image labels during the build. Both components version in lockstep with the system version: the git tag `v{x.y.z}` always matches `version` in `server/package.json` and `frontend/package.json`.

## Release Process

1. Bump component versions in `server/package.json` and `frontend/package.json`
2. Sync lock files: `npm install --package-lock-only` in `server/` and `frontend/`
3. Commit the version bump (include both manifests and lock files)
4. Tag: `git tag v{version}` (e.g., `git tag v0.2.0`)
5. Push the branch, then that one tag by name:
   ```bash
   git push origin main
   git push origin v{version}          # the tag from step 4 — never a hardcoded one
   ```

Never push with `--tags`. It publishes every local tag, and tags that exist only
locally — milestone or working markers — must stay local. Only release tags belong on
the remote.

The tag push triggers the GitHub Actions workflow (`.github/workflows/release-images.yml`), which runs `make release` to build and push container images to GHCR.

## Local Build

```bash
make release VERSION=0.2.0              # Build locally
make release VERSION=0.2.0 PUSH=true    # Build and push
```
