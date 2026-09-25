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
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
