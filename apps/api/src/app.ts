import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import fastifyStatic from "@fastify/static";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { registerAdminRoutes } from "./admin-routes.js";
import { registerAboutRoutes } from "./about-routes.js";
import { registerCooperationRoutes } from "./cooperation-routes.js";
import { registerAuthRoutes } from "./auth-routes.js";
import { registerBotRoutes } from "./bot-routes.js";
import { prisma } from "./db.js";
import { registerMarketRoutes } from "./market-routes.js";
import { registerLegalRoutes } from "./legal-routes.js";
import { registerProfileRoutes } from "./profile-routes.js";
import { registerTaskRoutes } from "./task-routes.js";
import { registerUploadRoutes } from "./upload-routes.js";
import { registerFaqRoutes } from "./faq-routes.js";
import { registerMaxRoutes } from "./max-routes.js";
import { registerLibraryRoutes } from "./library-routes.js";

export async function buildApp() {
  const app = Fastify({ logger: { level: process.env.NODE_ENV === "test" ? "silent" : "info" }, trustProxy: false, bodyLimit: 1_200_000 });
  await app.register(cookie);
  await app.register(helmet, { contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], baseUri: ["'self'"], objectSrc: ["'none'"], formAction: ["'self'"], frameAncestors: ["'self'", "https://max.ru"],
    scriptSrc: ["'self'", "'unsafe-inline'", "https://st.max.ru"], styleSrc: ["'self'", "'unsafe-inline'"], fontSrc: ["'self'", "data:"],
    imgSrc: ["'self'", "data:", "blob:", "https:"], connectSrc: ["'self'"],
  } } });
  await app.register(rateLimit, {
    max: 120,
    timeWindow: "1 minute",
    keyGenerator: (request) => {
      const sessionToken = request.cookies.vibe_session;
      const identity = sessionToken ? createHash("sha256").update(sessionToken).digest("hex") : "anonymous";
      return `${request.ip}:${identity}`;
    },
  });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 5, fields: 8 } });

  const webDist = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  const serveWeb = (process.env.NODE_ENV === "production" || process.env.SERVE_WEB_DIST === "true") && existsSync(webDist);
  if (serveWeb) await app.register(fastifyStatic, { root: webDist, prefix: "/" });

  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/api/") || !["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return;
    if (request.url.startsWith("/api/dev/") || request.url.startsWith("/api/auth/") || request.url.startsWith("/api/webhooks/max")) return;
    const csrf = request.cookies.vibe_csrf;
    const header = request.headers["x-csrf-token"];
    if (!csrf || typeof header !== "string" || csrf !== header) return reply.code(403).send({ error: "Обновите страницу и повторите действие" });
  });

  app.get("/api/health", async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, service: "vibe-api", database: "connected" };
  });
  await registerAuthRoutes(app);
  await registerFaqRoutes(app);
  await registerLibraryRoutes(app);
  await registerMaxRoutes(app);
  await registerLegalRoutes(app);
  await registerAboutRoutes(app);
  await registerCooperationRoutes(app);
  await registerProfileRoutes(app);
  await registerTaskRoutes(app);
  await registerUploadRoutes(app);
  await registerMarketRoutes(app);
  await registerAdminRoutes(app);
  await registerBotRoutes(app);

  app.get("/favicon.ico", async (_request, reply) => reply.type("image/png").send(await readFile(resolve(webDist, "brand/vibe-logo.png"))));

  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith("/api/")) return reply.code(404).send({ error: "Маршрут не найден" });
    if (serveWeb && request.method === "GET") return reply.type("text/html; charset=utf-8").send(await readFile(resolve(webDist, "index.html")));
    return reply.code(404).send({ error: "Страница не найдена" });
  });
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, "Request failed");
    const code = error instanceof Error && "statusCode" in error && typeof error.statusCode === "number" && error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500;
    return reply.code(code).send({ error: code >= 500 ? "Временная ошибка сервера. Повторите действие." : error instanceof Error ? error.message : "Ошибка запроса" });
  });
  return app;
}
