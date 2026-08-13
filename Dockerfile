# Readit — one image, one process: the API also serves the built web app.
#
#   docker build -t readit .
#   docker run -p 4000:4000 -v readit-data:/data -e READIT_PASSWORD=... readit
#
# See docs/DEPLOY.md.

# ---------------------------------------------------------------- build ---
FROM node:22-bookworm-slim AS build

# better-sqlite3 ships prebuilds for most platforms, but keep a toolchain here
# so an architecture without one still builds rather than failing the image.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy manifests first so `npm ci` is cached until a dependency actually changes.
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci

COPY . .
RUN npm run build

# Drop dev dependencies from the tree we are about to copy into the runtime.
RUN npm prune --omit=dev

# npm workspaces normally hoist every dependency to the root node_modules, but
# a version conflict makes it nest one under the workspace instead. Guarantee
# both paths exist so the COPYs below are valid either way.
RUN mkdir -p /app/server/node_modules /app/web/node_modules

# -------------------------------------------------------------- runtime ---
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    READIT_DATA_DIR=/data

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/node_modules ./server/node_modules
# The bundled dictionaries are application data, not user data.
COPY --from=build /app/server/data ./server/data
COPY --from=build /app/web/dist ./web/dist

# The library and its SQLite database live here. Mount a volume, or every
# redeploy starts an empty library.
VOLUME ["/data"]
RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]
