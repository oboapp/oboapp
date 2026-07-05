# Multi-stage build for minimal image size
FROM node:20-slim AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

WORKDIR /app

# Copy workspace root config files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy shared, db and ingest package files
COPY shared ./shared
COPY db ./db
COPY ingest ./ingest

# Install workspace dependencies without lifecycle scripts
RUN pnpm install --frozen-lockfile --ignore-scripts

# Build shared and db packages first (ingest depends on them)
WORKDIR /app/shared
RUN pnpm build

WORKDIR /app/db
RUN pnpm build

# Run ingest package commands from package working directory
WORKDIR /app/ingest

# Install Chromium ONLY (no system deps here) using lockfile-pinned Playwright
RUN pnpm exec playwright install chromium

# Build ingest
RUN pnpm build

WORKDIR /app

# Production stage
FROM node:20-slim

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

WORKDIR /app

# Install system dependencies for Playwright/Chromium including fonts
RUN apt-get update && apt-get install -y \
    fonts-dejavu-core \
    fonts-freefont-ttf \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    libxshmfence1 \
    && rm -rf /var/lib/apt/lists/*

# Copy workspace root config files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy shared and db packages
COPY shared ./shared
COPY db ./db

# Copy ingest package files
COPY ingest/package.json ./ingest/

# Install only production dependencies (skip postinstall since shared is already built)
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# Copy Playwright browser cache
COPY --from=builder /root/.cache/ms-playwright /home/node/.cache/ms-playwright

# Copy built shared package dist folder
COPY --from=builder /app/shared/dist ./shared/dist

# Copy built db package dist folder
COPY --from=builder /app/db/dist ./db/dist

# Copy only the built JavaScript files and necessary runtime files
COPY --from=builder /app/ingest/dist ./ingest/dist
COPY --from=builder /app/ingest/package*.json ./ingest/
COPY --from=builder /app/ingest/prompts ./ingest/prompts
COPY --from=builder /app/ingest/crawlers ./ingest/crawlers
COPY --from=builder /app/ingest/localities ./ingest/localities

# Run as a non-root user in production image.
RUN chown -R node:node /app /home/node/.cache

ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/home/node/.cache/ms-playwright

WORKDIR /app/ingest

USER node

CMD ["pnpm", "run", "prebuilt:crawl", "--", "--help"]
