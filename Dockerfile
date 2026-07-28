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
ENV HOST=0.0.0.0
ENV PORT=3000

# Startup: migrar, arrancar worker en background, server en foreground.
RUN printf '#!/bin/sh\nset -e\ncd /app\necho "[start] Running Prisma migrations..."\nnpx prisma migrate deploy --schema=./prisma/schema.prisma\necho "[start] Starting worker..."\nnode dist/src/worker.js &\necho "[start] Starting web server..."\nexec node dist/src/server.js\n' > /start.sh && chmod +x /start.sh

EXPOSE 3000
CMD ["/start.sh"]
