import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "./db.js";
import { getMaxPollingStatus, sendBotCommand } from "./bot.js";
import { requireAuth } from "./security.js";
import { maxConfigStatus } from "./max-service.js";

const demoEnabled = () => process.env.NODE_ENV !== "production";

export async function registerBotRoutes(app: FastifyInstance) {
  app.get("/api/bot/status", async (request, reply) => {
    const context = await requireAuth(request, reply);
    if (!context) return;
    const mock = await prisma.botMessage.count({ where: { userId: context.user.id } });
    const config = maxConfigStatus();
    return { transport: config.transport, enabled: config.enabled, configured: config.enabled && config.tokenConfigured, linked: Boolean(context.user.maxUserId), botStarted: Boolean(context.user.maxBotStartedAt), realMaxVerified: false, maxPolling: getMaxPollingStatus(), mockMessageCount: mock };
  });

  app.get("/api/bot/mock-log", async (request, reply) => {
    const context = await requireAuth(request, reply);
    if (!context) return;
    if (!demoEnabled()) return reply.code(404).send({ error: "Локальный диалог доступен только в разработке" });
    const messages = await prisma.botMessage.findMany({ where: { userId: context.user.id }, orderBy: { createdAt: "asc" }, take: 100 });
    const outbox = await prisma.outbox.findMany({ where: { transport: "mock", recipient: { in: [context.user.maxUserId, context.user.id].filter((value): value is string => Boolean(value)) } }, orderBy: { createdAt: "desc" }, take: 20 });
    return { messages, outbox: outbox.map((row) => ({ id: row.id, body: JSON.parse(row.body), createdAt: row.createdAt, status: row.status })) };
  });

  app.post("/api/bot/mock-command", async (request, reply) => {
    const context = await requireAuth(request, reply);
    if (!context) return;
    if (!demoEnabled()) return reply.code(404).send({ error: "Mock-команды доступны только в разработке" });
    const parsed = z.object({ command: z.string().trim().min(1).max(100) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Введите одну команду бота" });
    return sendBotCommand(context.user.id, parsed.data.command);
  });

  app.get("/api/notifications", async (request, reply) => {
    const context = await requireAuth(request, reply);
    if (!context) return;
    const [items, unread] = await Promise.all([
      prisma.notification.findMany({ where: { userId: context.user.id }, orderBy: { createdAt: "desc" }, take: 30 }),
      prisma.notification.count({ where: { userId: context.user.id, readAt: null } }),
    ]);
    return { items, unread };
  });

  app.post<{ Params: { id: string } }>("/api/notifications/:id/read", async (request, reply) => {
    const context = await requireAuth(request, reply);
    if (!context) return;
    const updated = await prisma.notification.updateMany({ where: { id: request.params.id, userId: context.user.id, readAt: null }, data: { readAt: new Date() } });
    if (!updated.count) return reply.code(404).send({ error: "Уведомление не найдено или уже прочитано" });
    return { ok: true };
  });
}
