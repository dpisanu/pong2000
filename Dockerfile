# Stage 1: Build client assets
FROM node:22-slim AS builder
WORKDIR /app

COPY package.json ./
RUN npm install --legacy-peer-deps --no-audit --no-fund

COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY shared ./shared
COPY src ./src

RUN npm run build

# Stage 2: Production runtime
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV AVATAR_STORAGE_DIR=/data/avatars

COPY package.json ./
RUN npm install --omit=dev --legacy-peer-deps --no-audit --no-fund

COPY --from=builder /app/dist ./dist
COPY server.ts ./
COPY server ./server
COPY shared ./shared
COPY public ./public

RUN mkdir -p /data/avatars && chown -R node:node /app /data
USER node

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "--experimental-strip-types", "server.ts"]
