import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { handleMaxUpdate } from "./bot.js";
import { prisma } from "./db.js";
import { isMaxConfigured, isMaxEnabled, MaxApiClient, maxConfigStatus, verifyMaxWebhookSecret } from "./max-service.js";
import { requireRole } from "./security.js";

const saveCursor = (key: string, value: string) => prisma.botCursor.upsert({ where: { key }, create: { key, value }, update: { value } });

export async function registerMaxRoutes(app: FastifyInstance) {
  app.get("/api/owner/max/status", async (request, reply) => {
    const context = await requireRole(request, reply, ["PROJECT_OWNER"]);
    if (!context) return;
    const [lastSuccess, lastResult] = await Promise.all([
      prisma.botCursor.findUnique({ where: { key: "max_health_last_success" } }),
      prisma.botCursor.findUnique({ where: { key: "max_health_last_result" } }),
    ]);
    const config = maxConfigStatus();
    const status = !config.enabled ? "DISABLED" : !config.tokenConfigured ? "NOT_CONFIGURED" : lastResult?.value === "ERROR" ? "ERROR" : lastSuccess ? "CONNECTED" : "NOT_CHECKED";
    return { ...config, status, lastSuccessfulCheck: lastSuccess?.value ?? null };
  });

  app.post("/api/owner/max/check", async (request, reply) => {
    const context = await requireRole(request, reply, ["PROJECT_OWNER"]);
    if (!context) return;
    if (!isMaxEnabled()) return reply.code(409).send({ error: "MAX отключён в серверной конфигурации. Сайт и локальный вход продолжают работать." });
    if (!isMaxConfigured()) return reply.code(503).send({ error: "Секрет MAX не настроен на сервере." });
    try {
      const bot = await new MaxApiClient(process.env.MAX_BOT_TOKEN!).getMe();
      const configuredUsername = maxConfigStatus().username;
      if (bot.is_bot === false) throw new Error("Интеграция MAX настроена не на аккаунт бота");
      if (configuredUsername && bot.username && configuredUsername.toLowerCase() !== bot.username.replace(/^@/u, "").toLowerCase()) throw new Error("Имя бота в серверной настройке не совпадает с ответом MAX");
      const checkedAt = new Date().toISOString();
      await Promise.all([saveCursor("max_health_last_success", checkedAt), saveCursor("max_health_last_result", "OK")]);
      return { ok: true, status: "CONNECTED", botName: bot.name ?? null, botUsername: bot.username ?? configuredUsername, lastSuccessfulCheck: checkedAt };
    } catch {
      await saveCursor("max_health_last_result", "ERROR");
      return reply.code(502).send({ error: "MAX не подтвердил подключение. Проверьте секрет, имя бота и доступность официального API; сам секрет не отображается." });
    }
  });

  app.post("/api/webhooks/max", async (request, reply) => {
    if (!isMaxEnabled() || !isMaxConfigured()) return reply.code(503).send({ error: "MAX webhook выключен" });
    const header = request.headers["x-max-bot-api-secret"];
    if (!verifyMaxWebhookSecret(typeof header === "string" ? header : undefined)) return reply.code(401).send({ error: "Недействительный webhook" });
    const parsed = z.object({ update_type: z.string().min(1).max(80) }).passthrough().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Некорректный формат обновления MAX" });
    try {
      await handleMaxUpdate(parsed.data as Record<string, unknown>);
      return reply.code(200).send({ ok: true });
    } catch {
      return reply.code(503).send({ error: "Обновление MAX временно не обработано" });
    }
  });
}
