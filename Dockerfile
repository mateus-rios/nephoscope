# syntax=docker/dockerfile:1.7
# Nephoscope: one self-contained image with the API and the built web app (SPEC-0001 D-01, D-19).

ARG NODE_IMAGE=node:24-slim

# ---- base: pnpm through corepack, pinned by packageManager in package.json -------------------
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app
COPY package.json ./
RUN corepack enable && corepack install

# ---- deps: download every package once, keyed on the lockfile only ---------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch

# ---- build: contracts, then the API and the web app -------------------------------------------
FROM deps AS build
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --offline
RUN pnpm build

# ---- prod: production dependencies of the API and the packages it uses ------------------------
FROM deps AS prod
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Every workspace manifest, so the frozen lockfile still matches; the filter installs only the API's.
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile --offline --filter "@nephoscope/api..."

# ---- runtime -----------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
LABEL org.opencontainers.image.title="Nephoscope" \
      org.opencontainers.image.description="Self-hosted web console for Google Cloud, driven by your own keys. Not affiliated with Google." \
      org.opencontainers.image.licenses="Apache-2.0"
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    NEPHOSCOPE_DATA_DIR=/data \
    NEPHOSCOPE_WEB_DIST=/app/apps/web/dist \
    METADATA_SERVER_DETECTION=ping-only
WORKDIR /app

COPY --from=prod --chown=root:root /app/node_modules ./node_modules
COPY --from=prod --chown=root:root /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=prod --chown=root:root /app/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --from=build --chown=root:root /app/package.json ./package.json
COPY --from=build --chown=root:root /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build --chown=root:root /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build --chown=root:root /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=root:root /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=root:root /app/apps/web/dist ./apps/web/dist
# License, notice and third-party notices (SPEC-0001 D-28); the build step generated the last one.
COPY --from=build --chown=root:root /app/LICENSE /app/NOTICE /app/THIRD_PARTY_NOTICES.txt ./

# The app files belong to root and are read-only for the process; only /data is writable.
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

# Node receives SIGTERM directly and stops within 10 seconds (SPEC-0001 CA-68).
CMD ["node", "apps/api/dist/main.js"]
