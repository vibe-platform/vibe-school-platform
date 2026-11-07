#!/bin/sh
set -eu
mkdir -p /app/data/presentation /app/data/uploads
npm run db:migrate
if [ ! -f /app/data/presentation/.seeded ]; then
  npm run db:seed:presentation
  touch /app/data/presentation/.seeded
fi
exec node apps/api/dist/server.js
