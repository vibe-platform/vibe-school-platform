#!/bin/sh
set -eu
mkdir -p /app/data/presentation /app/data/uploads
npm run db:migrate
if [ ! -f /app/data/presentation/.seeded ]; then
  for archive in /app/contest-assets/public-*.tar; do tar -xf "$archive" -C /app/data/uploads; done
  (cd /app/data/uploads && sha256sum -c /app/contest-assets/manifest.sha256)
  npm run db:seed:presentation
  node /app/scripts/import-contest-content.mjs
  touch /app/data/presentation/.seeded
fi
exec node apps/api/dist/server.js
