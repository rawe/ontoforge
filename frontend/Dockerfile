FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine

ARG VERSION=dev
ARG COMPONENT_VERSION=0.0.0
ARG GIT_COMMIT=unknown
ARG BUILD_DATE=unknown

LABEL org.opencontainers.image.title="OntoForge UI" \
      org.opencontainers.image.description="Neo4j-native ontology studio frontend" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${GIT_COMMIT}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.source="https://github.com/rawe/ontoforge" \
      org.opencontainers.image.vendor="rawe" \
      org.opencontainers.image.licenses="MIT" \
      ontoforge.component="ui" \
      ontoforge.component.version="${COMPONENT_VERSION}"

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
