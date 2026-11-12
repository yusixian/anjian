FROM node:22-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
WORKDIR /app
COPY . .
WORKDIR /app/artifacts
RUN pnpm install --frozen-lockfile && pnpm build

FROM node:22-bookworm-slim AS docs-build
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
WORKDIR /app/website
COPY website/ ./
COPY CHANGELOG.md /app/CHANGELOG.md
COPY scripts/release/notes.mjs /app/scripts/release/notes.mjs
RUN pnpm install --frozen-lockfile && pnpm build

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
  ANJIAN_DOCS_DIR=/app/website/out \
  ANJIAN_SERVER_HOME=/data/server \
  ANJIAN_ARTIFACTS_PORTS=27319 \
  ANJIAN_ARTIFACTS_BOARD_PORTS=27329
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/artifacts/dist ./artifacts/dist
COPY --from=docs-build /app/website/out ./website/out
COPY LICENSE ./LICENSE
COPY artifacts/LICENSE ./artifacts/LICENSE
RUN mkdir -p /data/project /data/server && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 27319 27329
STOPSIGNAL SIGTERM
CMD ["node", "artifacts/dist/cli.cjs", "start", "--project-dir", "/data/project", "--host", "0.0.0.0", "--foreground", "--no-open"]
