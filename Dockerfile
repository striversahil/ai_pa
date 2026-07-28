# syntax=docker/dockerfile:1.4
# ──────────────────────────────────────────────────────────────
# Stage 1: Build Next.js Static Frontend (npm — standalone app)
# ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder
WORKDIR /app/founder-os_frontend

COPY founder-os_frontend/package.json founder-os_frontend/package-lock.json* ./
# Cache mount: npm packages survive across builds when lockfile unchanged
RUN --mount=type=cache,target=/root/.npm \
    npm install

COPY founder-os_frontend ./
# Cache mount: Next.js build cache (Turbopack/webpack) persists across rebuilds
RUN --mount=type=cache,target=/app/founder-os_frontend/.next/cache \
    npm run build

# ──────────────────────────────────────────────────────────────
# Stage 2: Build TypeScript Backend (pnpm)
# ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS backend-builder
WORKDIR /app/founder-os_backend

# Cache mount: pnpm global store persists across builds
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    npm install -g pnpm

# Copy workspace config so pnpm v10 allows Prisma build scripts
COPY founder-os_backend/pnpm-workspace.yaml ./

# Install deps — lockfile rarely changes so this layer stays cached
COPY founder-os_backend/package.json founder-os_backend/pnpm-lock.yaml founder-os_backend/tsconfig.json ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Copy prisma schema and generate typed client
COPY founder-os_backend/prisma ./prisma
RUN npx prisma@6.19.3 generate

# Copy full backend source and compile TypeScript → ./dist/
COPY founder-os_backend ./
RUN NODE_OPTIONS="--max-old-space-size=4096" pnpm run build

# Copy compiled frontend static bundle into backend public/ directory
COPY --from=frontend-builder /app/founder-os_frontend/out ./public

# ──────────────────────────────────────────────────────────────
# Stage 3: Production Runner (minimal image, no prune needed)
# ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    npm install -g pnpm

# Copy workspace config and package files
COPY founder-os_backend/pnpm-workspace.yaml founder-os_backend/package.json founder-os_backend/pnpm-lock.yaml ./
COPY google-service-account.json* ./

# Copy compiled output and node_modules from builder stage
COPY --from=backend-builder /app/founder-os_backend/dist ./dist
COPY --from=backend-builder /app/founder-os_backend/prisma ./prisma
COPY --from=backend-builder /app/founder-os_backend/public ./public
COPY --from=backend-builder /app/founder-os_backend/node_modules ./node_modules

EXPOSE 3000
CMD ["node", "dist/server.js"]
