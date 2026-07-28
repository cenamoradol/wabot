# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS builder
WORKDIR /app

RUN apk add --no-cache openssl

COPY package.json package-lock.json* ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate --schema=./prisma/schema.prisma

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# === Runtime ===
FROM node:22-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache openssl

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

ENV NODE_ENV=production

# CMD inline (sin script externo) — Railway ejecuta esto al iniciar el container.
# 1. Migrar Prisma
# 2. Worker en background (&)
# 3. Server en foreground (exec) — así recibe SIGTERM correctamente
EXPOSE 8080
CMD ["/bin/sh", "-c", "echo '[start] Running Prisma migrations...' && npx prisma migrate deploy --schema=./prisma/schema.prisma && echo '[start] Starting worker...' && node dist/src/worker.js & echo '[start] Starting web server...' && exec node dist/src/server.js"]
