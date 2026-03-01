# ==============================================================================
# OntoForge — Container Image Release
# ==============================================================================
# Build and optionally push versioned container images to GitHub Container Registry.
#
# Usage:
#   make release VERSION=1.0.0                    # Build all images locally
#   make release VERSION=1.0.0 PUSH=true          # Build and push to registry
#   make release VERSION=1.0.0 REGISTRY=ghcr.io/other  # Override registry
#
# Individual components:
#   make release-server VERSION=1.0.0
#   make release-ui VERSION=1.0.0
#
# The VERSION parameter is required and should match the git tag (without 'v' prefix).
# Example: git tag v1.0.0 → make release VERSION=1.0.0

.PHONY: help release release-server release-ui _check-version

# ==============================================================================
# CONTAINER IMAGE RELEASE CONFIGURATION
# ==============================================================================
# Default registry (GitHub Container Registry)
REGISTRY ?= ghcr.io/rawe

# Image names
IMAGE_SERVER := $(REGISTRY)/ontoforge-server
IMAGE_UI := $(REGISTRY)/ontoforge-ui

# Build metadata
GIT_COMMIT := $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BUILD_DATE := $(shell date -u +"%Y-%m-%dT%H:%M:%SZ")

# Component versions (from their respective package files)
SERVER_VERSION := $(shell grep -m1 'version' backend/pyproject.toml | cut -d'"' -f2)
UI_VERSION := $(shell grep -m1 '"version"' frontend/package.json | cut -d'"' -f4)

# Default target
help:
	@echo "OntoForge — Container Image Release"
	@echo ""
	@echo "Available commands:"
	@echo "  make release VERSION=x.y.z               - Build all release images"
	@echo "  make release VERSION=x.y.z PUSH=true     - Build and push to registry"
	@echo "  make release-server VERSION=x.y.z        - Build server image only"
	@echo "  make release-ui VERSION=x.y.z            - Build UI image only"

# ==============================================================================
# RELEASE TARGETS
# ==============================================================================
# Builds use docker buildx with two modes:
#   PUSH=true (CI):  Registry-based BuildKit layer cache (--cache-from/--cache-to)
#                     reuses dependency layers across ephemeral GitHub Actions runners.
#                     Images are pushed to GHCR in one step via --push.
#   No PUSH (local): --load into local daemon, no registry interaction, works offline.
#
# Cache strategy: Each image has a :buildcache tag in GHCR that stores cached layers.
# The Dockerfiles copy dependency files (pyproject.toml/package.json) before source code,
# so dependency-install layers are cache hits when only source code changes. The UI image
# is multi-stage (Node build → nginx), so mode=max is used to cache all stages.

release: _check-version release-server release-ui
	@echo ""
	@echo "════════════════════════════════════════════════════════════════════════════"
	@echo "  Release $(VERSION) complete!"
	@echo "════════════════════════════════════════════════════════════════════════════"
	@echo ""
	@echo "Images built:"
	@echo "  $(IMAGE_SERVER):$(VERSION)"
	@echo "  $(IMAGE_UI):$(VERSION)"
	@echo ""
ifdef PUSH
	@echo "Images have been pushed to $(REGISTRY)"
else
	@echo "To push images, run: make release VERSION=$(VERSION) PUSH=true"
endif

_check-version:
ifndef VERSION
	$(error VERSION is required. Usage: make release VERSION=1.0.0)
endif

release-server: _check-version
	@echo ""
	@echo "Building $(IMAGE_SERVER):$(VERSION)..."
	@echo "  Component version: $(SERVER_VERSION)"
	@echo "  Git commit: $(GIT_COMMIT)"
	@echo ""
ifdef PUSH
	docker buildx build \
		--platform linux/amd64,linux/arm64 \
		--build-arg VERSION=$(VERSION) \
		--build-arg COMPONENT_VERSION=$(SERVER_VERSION) \
		--build-arg GIT_COMMIT=$(GIT_COMMIT) \
		--build-arg BUILD_DATE=$(BUILD_DATE) \
		--cache-from type=registry,ref=$(IMAGE_SERVER):buildcache \
		--cache-to type=registry,ref=$(IMAGE_SERVER):buildcache,mode=max \
		-t $(IMAGE_SERVER):$(VERSION) \
		-t $(IMAGE_SERVER):latest \
		-f backend/Dockerfile \
		--push \
		backend
else
	docker buildx build \
		--build-arg VERSION=$(VERSION) \
		--build-arg COMPONENT_VERSION=$(SERVER_VERSION) \
		--build-arg GIT_COMMIT=$(GIT_COMMIT) \
		--build-arg BUILD_DATE=$(BUILD_DATE) \
		-t $(IMAGE_SERVER):$(VERSION) \
		-t $(IMAGE_SERVER):latest \
		-f backend/Dockerfile \
		--load \
		backend
endif

release-ui: _check-version
	@echo ""
	@echo "Building $(IMAGE_UI):$(VERSION)..."
	@echo "  Component version: $(UI_VERSION)"
	@echo "  Git commit: $(GIT_COMMIT)"
	@echo ""
ifdef PUSH
	docker buildx build \
		--platform linux/amd64,linux/arm64 \
		--build-arg VERSION=$(VERSION) \
		--build-arg COMPONENT_VERSION=$(UI_VERSION) \
		--build-arg GIT_COMMIT=$(GIT_COMMIT) \
		--build-arg BUILD_DATE=$(BUILD_DATE) \
		--cache-from type=registry,ref=$(IMAGE_UI):buildcache \
		--cache-to type=registry,ref=$(IMAGE_UI):buildcache,mode=max \
		-t $(IMAGE_UI):$(VERSION) \
		-t $(IMAGE_UI):latest \
		-f frontend/Dockerfile \
		--push \
		frontend
else
	docker buildx build \
		--build-arg VERSION=$(VERSION) \
		--build-arg COMPONENT_VERSION=$(UI_VERSION) \
		--build-arg GIT_COMMIT=$(GIT_COMMIT) \
		--build-arg BUILD_DATE=$(BUILD_DATE) \
		-t $(IMAGE_UI):$(VERSION) \
		-t $(IMAGE_UI):latest \
		-f frontend/Dockerfile \
		--load \
		frontend
endif
