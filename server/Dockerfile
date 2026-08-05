# Build stage: install all dependencies (incl. dev) and compile TypeScript
FROM node:22-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# Runtime stage: production dependencies and compiled output only
FROM node:22-slim

ARG VERSION=dev
ARG COMPONENT_VERSION=0.0.0
ARG GIT_COMMIT=unknown
ARG BUILD_DATE=unknown

LABEL org.opencontainers.image.title="OntoForge Server" \
      org.opencontainers.image.description="Graph-native ontology studio backend" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${GIT_COMMIT}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.source="https://github.com/rawe/ontoforge" \
      org.opencontainers.image.vendor="rawe" \
      org.opencontainers.image.licenses="MIT" \
      ontoforge.component="server" \
      ontoforge.component.version="${COMPONENT_VERSION}"

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist/ dist/

EXPOSE 8000
CMD ["node", "dist/main.js"]
