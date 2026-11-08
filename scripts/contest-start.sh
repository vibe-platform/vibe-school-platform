#!/bin/sh
set -eu
mkdir -p /app/data/presentation /app/data/uploads
npm run db:migrate
if [ ! -f /app/data/presentation/.seeded ]; then
  for archive in /app/contest-assets/public-*.tar; do tar -xf "$archive" -C /app/data/uploads; done
  (cd /app/data/uploads && sha256sum -c /app/contest-assets/manifest.sha256)
  CONTEST_EMPTY_ASSIGNMENTS=true npm run db:seed:presentation
  node /app/scripts/import-contest-content.mjs
  touch /app/data/presentation/.seeded
fi
# Apply the published photo update to pre-existing contest volumes as well.
if [ ! -f "/app/data/uploads/f1ff6abc9905a49e58caa870bf828ea102548602938466b9ddb4a2565c98c618.jpg" ]; then
  tar -xf /app/contest-assets/public-06.tar -C /app/data/uploads f1ff6abc9905a49e58caa870bf828ea102548602938466b9ddb4a2565c98c618.jpg
fi
(cd /app/data/uploads && echo '0337a1144f830815b3635436222b9704f5a4be12e21e8da5a6199b6d11b43929  f1ff6abc9905a49e58caa870bf828ea102548602938466b9ddb4a2565c98c618.jpg' | sha256sum -c -)
node /app/scripts/sync-maxim-photo.mjs
node /app/scripts/upgrade-contest-documents.mjs
exec node apps/api/dist/server.js
