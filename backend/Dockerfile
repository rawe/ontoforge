FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

ARG VERSION=dev
ARG COMPONENT_VERSION=0.0.0
ARG GIT_COMMIT=unknown
ARG BUILD_DATE=unknown

LABEL org.opencontainers.image.title="OntoForge Server" \
      org.opencontainers.image.description="Neo4j-native ontology studio backend" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${GIT_COMMIT}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.source="https://github.com/rawe/ontoforge" \
      org.opencontainers.image.vendor="rawe" \
      org.opencontainers.image.licenses="MIT" \
      ontoforge.component="server" \
      ontoforge.component.version="${COMPONENT_VERSION}"

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY src/ src/

EXPOSE 8000
CMD ["uv", "run", "uvicorn", "ontoforge_server.main:app", "--host", "0.0.0.0", "--port", "8000"]
