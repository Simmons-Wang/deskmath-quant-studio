FROM node:22-slim AS builder
WORKDIR /app

COPY package.json ./
COPY shared ./shared
COPY client/package.json ./client/
COPY server/package.json ./server/

RUN npm install --prefix client && npm install --prefix server

COPY client ./client
COPY server ./server

RUN npm --prefix client run build && npm --prefix server run build

FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
ENV DATABASE_PATH=/app/data/quantmath.db

COPY --from=builder /app/shared ./shared
COPY --from=builder /app/server/package.json ./server/package.json
COPY --from=builder /app/server/node_modules ./server/node_modules
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/client/dist ./client/dist

RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--no-warnings", "server/dist/server/src/index.js"]
