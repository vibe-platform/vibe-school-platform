FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build && mkdir -p /app/data/presentation /app/data/uploads && chown -R node:node /app/data
ENV NODE_ENV=development HOST=0.0.0.0 API_PORT=3101 SERVE_WEB_DIST=true DEMO_MODE=true ENABLE_TEST_LOGIN=true DATABASE_URL=file:/app/data/presentation/vibe.db UPLOAD_DIR=/app/data/uploads MAX_BOT_ENABLED=false
USER node
EXPOSE 3101
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=6 CMD node -e "fetch('http://127.0.0.1:3101/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "/app/scripts/contest-start.sh"]
