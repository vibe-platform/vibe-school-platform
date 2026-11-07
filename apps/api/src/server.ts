import "dotenv/config";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { autoSubmitExpired, sendDueReminders } from "./task-routes.js";
import { cleanExpiredUploads } from "./upload-routes.js";
import { dispatchBotOutboxBatch, pollMaxUpdatesOnce } from "./bot.js";

const app = await buildApp();
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.API_PORT ?? 3001);
await app.listen({ host, port });
console.info(`Вайб API работает на http://${host}:${port}`);

const timer = setInterval(() => { void autoSubmitExpired().catch((error) => app.log.error({ err: error }, "Не удалось обработать просроченные работы")); }, 15_000);
timer.unref();
const cleanupTimer = setInterval(() => { void cleanExpiredUploads().catch((error) => app.log.error({ err: error }, "Не удалось очистить временные фото")); }, 60 * 60_000);
cleanupTimer.unref();
const botTimer = setInterval(() => {
  void dispatchBotOutboxBatch().catch((error) => app.log.error({ err: error }, "Не удалось обработать очередь сообщений"));
}, 1_000);
botTimer.unref();
const maxPollingTimer = setInterval(() => {
  void pollMaxUpdatesOnce().catch((error) => app.log.warn({ err: error }, "Локальный MAX polling не выполнен"));
}, 15_000);
maxPollingTimer.unref();
const reminderTimer = setInterval(() => { void sendDueReminders().catch((error) => app.log.error({ err: error }, "Не удалось проверить сроки заданий")); }, 15 * 60_000);
reminderTimer.unref();
void autoSubmitExpired().catch((error) => app.log.error({ err: error }, "Не удалось восстановить просроченные работы"));
void cleanExpiredUploads().catch((error) => app.log.error({ err: error }, "Не удалось восстановить очистку временных фото"));
void dispatchBotOutboxBatch().catch((error) => app.log.error({ err: error }, "Не удалось восстановить очередь сообщений"));
void pollMaxUpdatesOnce().catch((error) => app.log.warn({ err: error }, "Локальный MAX polling не выполнен"));
void sendDueReminders().catch((error) => app.log.error({ err: error }, "Не удалось восстановить напоминания о сроках"));

const close = async () => { clearInterval(timer); clearInterval(cleanupTimer); clearInterval(botTimer); clearInterval(maxPollingTimer); clearInterval(reminderTimer); await app.close(); await prisma.$disconnect(); };
process.once("SIGINT", () => { void close().then(() => process.exit(0)); });
process.once("SIGTERM", () => { void close().then(() => process.exit(0)); });
