FROM node:24.18.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/client/package.json ./apps/client/package.json
RUN npm ci
COPY apps/client ./apps/client
COPY scripts/build.mjs ./scripts/build.mjs
COPY server/runtime.mjs ./server/runtime.mjs
RUN node scripts/build.mjs web

FROM node:24.18.0-bookworm-slim
ENV NODE_ENV=production APP_MODE=production HOST=0.0.0.0 PORT=8787 DB_PATH=/app/data/linliji.sqlite STATIC_DIR=/app/public BACKUP_DIR=/app/backups
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/client/package.json ./apps/client/package.json
RUN npm ci --omit=dev --workspaces=false && npm cache clean --force
COPY --chown=node:node server ./server
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node apps/operations ./apps/operations
COPY --chown=node:node design/brand ./design/brand
COPY --from=build --chown=node:node /app/dist/web ./public
RUN mkdir -p data backups && chown node:node data backups
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","server/index.mjs"]
