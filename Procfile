web:    node --env-file-if-exists=.env dist/src/server.js
worker: node --env-file-if-exists=.env dist/src/worker.js
release: npx prisma migrate deploy --schema=./prisma/schema.prisma