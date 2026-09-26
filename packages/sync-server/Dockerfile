FROM node:20-alpine AS build
WORKDIR /app/packages/sync-server
COPY packages/sync-server/package.json ./
RUN npm install --ignore-scripts
COPY packages/sync-server .
RUN npx prisma generate && npm run build

FROM node:20-alpine
# OpenSSL: Prisma's schema engine (migrate deploy) cannot load without it.
RUN apk add --no-cache openssl
WORKDIR /app
COPY --from=build /app/packages/sync-server/node_modules ./node_modules
COPY --from=build /app/packages/sync-server/dist ./dist
COPY --from=build /app/packages/sync-server/prisma ./prisma
COPY --from=build /app/packages/sync-server/package.json ./package.json
ENV NODE_ENV=production
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-3001}/health | grep -q '"status":"ok"'
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
