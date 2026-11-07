import { createHash, randomUUID } from "node:crypto";
import { levelForExp } from "@vibe/shared";
import { localDateKey, streakAt } from "./dates.js";
import { prisma } from "./db.js";
import { isMaxEnabled, maxApiBaseUrl, MaxApiClient } from "./max-service.js";
import type { MaxNotificationCategory } from "./notifications.js";

export type BotButton =
  | { type: "link"; text: string; url: string }
  | { type: "message"; text: string }
  | { type: "open_app"; text: string };
export type BotReply = { text: string; link?: string; buttons?: BotButton[] };
export interface BotTransport { readonly name: "mock" | "max"; send(recipient: string, message: BotReply): Promise<void> }

export class MockBotTransport implements BotTransport {
  readonly name = "mock" as const;
  async send(recipient: string, message: BotReply) {
    await prisma.outbox.create({ data: { dedupeKey: `mock:${recipient}:${createHash("sha256").update(message.text + (message.link ?? "")).digest("hex")}`, transport: "mock", recipient, body: JSON.stringify(message), status: "SENT", sentAt: new Date() } }).catch(() => undefined);
  }
}

export class MaxBotTransport implements BotTransport {
  readonly name = "max" as const;
  private readonly client: MaxApiClient;
  constructor(token: string) { this.client = new MaxApiClient(token); }
  async send(recipient: string, message: BotReply) {
    await this.client.sendMessage(recipient, message);
  }
}

export const createBotTransport = (): BotTransport => process.env.MAX_TRANSPORT === "max" && isMaxEnabled() && process.env.MAX_BOT_TOKEN
  ? new MaxBotTransport(process.env.MAX_BOT_TOKEN)
  : new MockBotTransport();

function appLink(route = "") {
  const miniApp = process.env.MAX_MINI_APP_URL?.trim();
  const botUrl = process.env.MAX_BOT_URL?.trim() || (process.env.MAX_BOT_USERNAME ? `https://max.ru/${process.env.MAX_BOT_USERNAME.replace(/^@/u, "")}` : "");
  if (miniApp && botUrl) {
    const launch = new URL(botUrl);
    launch.searchParams.set("startapp", `vibe_route_${route || "home"}`);
    return launch.toString();
  }
  const publicUrl = process.env.PUBLIC_APP_URL ?? "http://127.0.0.1:5173";
  const routePath: Record<string, string> = { home: "/", tasks: "/tasks", profile: "/profile", about: "/about", market: "/market", faq: "/faq", "profile#settings": "/profile#settings", "profile/customize": "/profile/customize" };
  return new URL(routePath[route] ?? `/${route.replace(/^\//u, "")}`, publicUrl).toString();
}

const startText = "👋 Привет! Добро пожаловать в ВАЙБ!\r\n\r\nШкольная жизнь интереснее, когда знания превращаются в возможности.\r\n\r\nВАЙБ — это пространство, где твои достижения, инициативы и интересы помогают открывать новые горизонты.\r\n\r\nЗдесь ты сможешь следить за своим прогрессом, участвовать в активностях, зарабатывать Эйнштейны и открывать доступ к новым возможностям.\r\n\r\nТвой путь — твои интересы — твой ВАЙБ.\r\n\r\nДавай познакомимся поближе и настроим твой профиль. Это займёт всего пару минут.\r\n\r\n👇 Начнём?";
const supportText = "🛟 ПОДДЕРЖКА ВАЙБА\r\n\r\nВозник вопрос, что-то не работает или нужна помощь с использованием ВАЙБА?\r\n\r\nМы постараемся помочь!\r\n\r\n📩 Наша электронная почта:\r\n\r\nvaibe32@mail.ru\r\n\r\nЧтобы мы быстрее разобрались в ситуации, расскажи:\r\n\r\n• Что именно произошло?\r\n\r\n• В каком разделе возникла проблема?\r\n\r\n• Что ты пытался сделать?\r\n\r\nЕсли возможно, приложи скриншот ошибки, предварительно скрыв личные данные.\r\n\r\n🔐 Никогда не отправляй пароли, коды подтверждения или другие секретные данные.\r\n\r\n💜 Спасибо, что помогаешь делать ВАЙБ лучше!";
const aboutText = "💡 ЧТО ТАКОЕ ВАЙБ?\r\n\r\nВАЙБ — это цифровая система образовательной мотивации, которая помогает превращать учебную и внеучебную активность в новые возможности.\r\n\r\nМы верим, что образование — это не только оценки. Это знания, инициативы, интересы, личные достижения и опыт, который помогает человеку развиваться.\r\n\r\n🚀 КАК ЭТО РАБОТАЕТ?\r\n\r\n1. Действуй.\r\n\r\nУчаствуй в образовательных мероприятиях, развивай свои навыки, проявляй инициативу и пробуй новое.\r\n\r\n2. Развивайся.\r\n\r\nОтслеживай собственный прогресс, открывай достижения и двигайся к личным целям.\r\n\r\n3. Получай Эйнштейны.\r\n\r\nВнутренняя валюта ВАЙБА позволяет учитывать твою активность и открывает доступ к предусмотренным системой возможностям.\r\n\r\n4. Открывай новое.\r\n\r\nИспользуй доступные возможности, знакомься с инициативами партнёров и находи направления для дальнейшего развития.\r\n\r\n✨ НАША ИДЕЯ\r\n\r\nВАЙБ — не гонка за чужими результатами. Здесь важно не то, насколько ты опережаешь других, а то, как ты развиваешься сам.\r\n\r\nМы хотим, чтобы образование давало не только знания, но и реальные возможности применять их на практике.\r\n\r\n🎯 ТВОЙ ПУТЬ. ТВОИ ИНТЕРЕСЫ. ТВОЙ ВАЙБ.\r\n\r\nДобро пожаловать в пространство, где твоя активность может стать началом новых достижений!";

const mainMenuButtons = (): BotButton[] => [
  { type: "open_app", text: "🚀 Открыть Вайб" },
  { type: "message", text: "👤 Профиль" },
  { type: "message", text: "💡 О Вайбе" },
  { type: "message", text: "✉️ Поддержка" },
];

export async function handleBotCommand(userId: string, command: string): Promise<BotReply> {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { memberships: { where: { active: true, approved: true }, include: { school: true, schoolClass: true }, orderBy: { createdAt: "asc" }, take: 1 } } });
  if (!user) return { text: "Не удалось найти аккаунт. Откройте Вайб и войдите заново." };
  const membership = user.memberships[0];
  const menuAction = command.trim().toLocaleLowerCase("ru-RU").replace(/^[^\p{L}/]+/u, "").trim();
  const normalized = menuAction.split(/\s/u)[0] ?? "";
  if (menuAction === "профиль" || normalized === "/profile") {
    const role = user.platformRole === "PROJECT_OWNER" ? "Владелец проекта" : membership?.isSchoolAdmin || membership?.role === "SCHOOL_ADMIN" ? "Администратор школы" : membership?.isTeacher || membership?.role === "TEACHER" ? "Учитель" : membership?.role === "STUDENT" ? "Ученик" : "Пока не назначена";
    const name = user.username || user.displayName || [user.firstName, user.lastName].filter(Boolean).join(" ") || "Не указано";
    const rows = [`👤 МОЙ ПРОФИЛЬ В ВАЙБЕ`, `✨ Никнейм: ${name}`, `🏫 Школа: ${membership?.school.name ?? "Не указано"}`, `📚 Класс: ${membership?.schoolClass?.name ?? "Не указано"}`, `🎓 Роль: ${role}`];
    rows.push(`🪙 Эйнштейны: ${membership ? membership.balance : "Не назначен"}`);
    if (membership?.role === "STUDENT" && !membership.isTeacher && !membership.isSchoolAdmin && user.platformRole !== "PROJECT_OWNER") {
      const days = await prisma.activityDay.findMany({ where: { membershipId: membership.id }, select: { dayKey: true }, orderBy: { dayKey: "desc" } });
      const today = localDateKey(new Date(), membership.school.timezone); const yesterday = new Date(`${today}T00:00:00Z`); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const active = new Set(days.map((day) => day.dayKey)); const anchor = active.has(today) ? today : yesterday.toISOString().slice(0, 10);
      rows.push(`⭐ Уровень: ${levelForExp(membership.totalExp)}`, `📈 Опыт: ${membership.totalExp}`, `🔥 Серия активности: ${streakAt(anchor, active)} дн.`);
    }
    rows.push("🚀 Продолжай развиваться и открывать новые возможности в ВАЙБЕ!");
    return { text: rows.join("\n\n") };
  }
  if (menuAction === "о вайбе" || normalized === "/about") return { text: aboutText };
  if (menuAction === "поддержка" || normalized === "/support") return { text: supportText };
  const routes: Record<string, BotReply> = {
    "/start": { text: startText, buttons: mainMenuButtons() },
    "/help": { text: "Команды: /tasks — задания, /profile — личный профиль, /market — награды, /customize — оформление, /balance — личный баланс, /settings — уведомления, /faq — вопросы и ответы.", buttons: mainMenuButtons() },
    "/tasks": { text: "Откройте список своих заданий. Ответы отправляются и проверяются в Вайбе.", link: appLink("tasks") },
    "/profile": { text: "Профиль и личный путь видны только вам.", link: appLink("profile") },
    "/about": { text: "Вайб помогает выполнять задания, замечать собственный прогресс и получать школьные награды.", link: appLink("about") },
    "/support": { text: "Поддержка Вайба: vaibe32@mail.ru. Напишите нам, если нужна помощь." },
    "/market": { text: "Посмотрите доступные школьные и общие награды.", link: appLink("market") },
    "/customize": { text: "Откройте свою коллекцию оформления.", link: appLink("profile/customize") },
    "/settings": { text: "Настройки уведомлений и тихих часов.", link: appLink("profile#settings") },
    "/faq": { text: "Ответы на вопросы о Вайбе, заданиях и личном прогрессе.", link: appLink("faq") },
  };
  if (normalized === "/balance") {
    const balance = membership?.balance ?? 0;
    return { text: membership?.role === "STUDENT" ? `Ваш баланс: ${balance} Эйнштейнов. Это личная информация.` : "Баланс ученика недоступен служебным аккаунтам." };
  }
  if (normalized === "/tasks" && membership?.role === "STUDENT") {
    const count = await prisma.assignment.count({ where: { published: true, archived: false, schoolId: membership.schoolId, targets: { some: { recipients: { some: { id: membership.id } } } } } });
    return { text: count ? `Для вас доступно заданий: ${count}. Награда появляется после завершения или подтверждения учителем.` : "Пока нет новых заданий.", link: appLink("tasks") };
  }
  if (normalized === "/faq") {
    const featured = await prisma.faqItem.findMany({ where: { isPublished: true, isFeatured: true, archivedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], take: 3, select: { question: true, answer: true } });
    return { text: featured.length ? featured.map((item, index) => `${index + 1}. ${item.question}\n${item.answer}`).join("\n\n").slice(0, 3500) : "Вопросы и ответы пока не опубликованы.", link: appLink("faq") };
  }
  return routes[normalized] ?? routes["/help"]!;
}

export async function sendBotCommand(userId: string, command: string, sourceEventId?: string) {
  const reply = await handleBotCommand(userId, command);
  if (sourceEventId) {
    await prisma.botMessage.upsert({ where: { sourceEventId: `in:${sourceEventId}` }, create: { userId, direction: "IN", sourceEventId: `in:${sourceEventId}`, text: command.slice(0, 500) }, update: {} });
    await prisma.botMessage.upsert({ where: { sourceEventId: `out:${sourceEventId}` }, create: { userId, direction: "OUT", sourceEventId: `out:${sourceEventId}`, text: reply.text.slice(0, 4000) }, update: {} });
  } else {
    await prisma.botMessage.create({ data: { userId, direction: "IN", text: command.slice(0, 500) } });
    await prisma.botMessage.create({ data: { userId, direction: "OUT", text: reply.text.slice(0, 4000) } });
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { maxUserId: true, maxBotStartedAt: true } });
  if (user?.maxUserId) {
    const transport = createBotTransport();
    if (transport.name === "mock") await transport.send(user.maxUserId, reply);
    else if (isMaxEnabled() && user.maxBotStartedAt) {
      const dedupeKey = sourceEventId ? `max:update:${sourceEventId}` : `manual:${userId}:${randomUUID()}`;
      await prisma.outbox.upsert({ where: { dedupeKey }, create: { dedupeKey, transport: "max", recipient: user.maxUserId, body: JSON.stringify(reply) }, update: {} });
    }
  }
  return reply;
}

const MAX_ATTEMPTS = 8;
const MAX_BATCH_SIZE = 20;
const LEASE_MS = 2 * 60_000;
type OutboxBody = BotReply & { userId?: string; category?: "TASKS" | "ORDERS" | "PROGRESS" | "COSMETICS"; maxCategory?: MaxNotificationCategory };

export async function dispatchBotOutboxBatch() {
  const now = new Date();
  await prisma.outbox.updateMany({ where: { status: "SENDING", nextAttemptAt: { lte: now } }, data: { status: "PENDING" } });
  const candidates = await prisma.outbox.findMany({ where: { status: "PENDING", nextAttemptAt: { lte: now } }, orderBy: { createdAt: "asc" }, take: MAX_BATCH_SIZE });
  let sent = 0;
  for (const candidate of candidates) {
    const leaseUntil = new Date(Date.now() + LEASE_MS);
    const claim = await prisma.outbox.updateMany({ where: { id: candidate.id, status: "PENDING", nextAttemptAt: { lte: now } }, data: { status: "SENDING", attempts: { increment: 1 }, nextAttemptAt: leaseUntil } });
    if (!claim.count) continue;
    const row = await prisma.outbox.findUnique({ where: { id: candidate.id } });
    if (!row) continue;
    try {
      const message = JSON.parse(row.body) as OutboxBody;
      const taskNotice = row.dedupeKey.match(/^notification:task:(?:assigned|reminder):([^:]+):/u);
      if (taskNotice) {
        const task = await prisma.assignment.findUnique({ where: { id: taskNotice[1] }, select: { archived: true, published: true } });
        if (!task || task.archived || !task.published) { await prisma.outbox.update({ where: { id: row.id }, data: { status: "SKIPPED", nextAttemptAt: new Date() } }); continue; }
      }
      if (message.category && message.userId) {
        const { notificationStillAllowed } = await import("./notifications.js");
        const policy = await prisma.$transaction((tx) => notificationStillAllowed(tx, message.userId!, message.category!, new Date(), message.maxCategory));
        if (!policy.allowed && policy.nextAttemptAt.getTime() > Date.now()) {
          await prisma.outbox.update({ where: { id: row.id }, data: { status: "PENDING", nextAttemptAt: policy.nextAttemptAt } });
          continue;
        }
        if (!policy.allowed) {
          await prisma.outbox.update({ where: { id: row.id }, data: { status: "SKIPPED", nextAttemptAt: new Date() } });
          continue;
        }
      }
      if (row.transport === "max") {
        if (!isMaxEnabled() || !process.env.MAX_BOT_TOKEN) { await prisma.outbox.update({ where: { id: row.id }, data: { status: "SKIPPED", nextAttemptAt: new Date() } }); continue; }
        await new MaxBotTransport(process.env.MAX_BOT_TOKEN).send(row.recipient, { text: message.text, ...(message.link ? { link: message.link } : {}), ...(message.buttons ? { buttons: message.buttons } : {}) });
      }
      await prisma.outbox.update({ where: { id: row.id }, data: { status: "SENT", sentAt: new Date() } });
      sent += 1;
    } catch (error) {
      const apiStatus = error instanceof Error ? error.message.match(/^MAX API ответил с кодом (\d+)$/u)?.[1] : undefined;
      console.error("Не удалось отправить сообщение MAX:", apiStatus ? `HTTP ${apiStatus}` : error instanceof Error ? error.name : "UnknownError");
      const attempt = row.attempts;
      const terminal = attempt >= MAX_ATTEMPTS;
      const delayMs = Math.min(60 * 60_000, 30_000 * 2 ** Math.min(attempt - 1, 7));
      await prisma.outbox.update({ where: { id: row.id }, data: { status: terminal ? "FAILED" : "PENDING", nextAttemptAt: terminal ? new Date() : new Date(Date.now() + delayMs) } });
    }
  }
  return sent;
}

export type MaxPollingStatus = { enabled: boolean; checked: boolean; webhookConflict: boolean; lastError: string | null; lastPollAt: string | null };
const pollingStatus: MaxPollingStatus = { enabled: false, checked: false, webhookConflict: false, lastError: null, lastPollAt: null };
let polling = false;
let subscriptionsChecked = false;
export const getMaxPollingStatus = () => ({ ...pollingStatus });

function eventIdentity(update: Record<string, unknown>) {
  const message = update.message as Record<string, unknown> | undefined;
  const body = message?.body as Record<string, unknown> | undefined;
  const callback = update.callback as Record<string, unknown> | undefined;
  const uniquePart = body?.mid ?? callback?.callback_id ?? `${String(update.update_type ?? "unknown")}:${String(update.timestamp ?? "")}:${createHash("sha256").update(JSON.stringify(update)).digest("hex")}`;
  return `max:${String(uniquePart)}`;
}

export async function handleMaxUpdate(update: Record<string, unknown>) {
  const eventId = eventIdentity(update);
  let event = await prisma.botEvent.findUnique({ where: { eventId } });
  if (!event) {
    try { event = await prisma.botEvent.create({ data: { eventId, status: "RECEIVED" } }); }
    catch (error) { if (!(error instanceof Error) || !("code" in error) || error.code !== "P2002") throw error; event = await prisma.botEvent.findUnique({ where: { eventId } }); }
  }
  if (!event || event.status === "PROCESSED") return;
  if (event.status === "PROCESSING" && event.receivedAt < new Date(Date.now() - 2 * 60_000)) {
    await prisma.botEvent.updateMany({ where: { id: event.id, status: "PROCESSING", receivedAt: { lt: new Date(Date.now() - 2 * 60_000) } }, data: { status: "RECEIVED" } });
  }
  const claimed = await prisma.botEvent.updateMany({ where: { id: event.id, status: "RECEIVED" }, data: { status: "PROCESSING" } });
  if (!claimed.count) return;
  const type = String(update.update_type ?? "");
  const message = update.message as Record<string, unknown> | undefined;
  const callback = update.callback as Record<string, unknown> | undefined;
  const sender = (message?.sender ?? callback?.user ?? update.user) as Record<string, unknown> | undefined;
  const rawUserId = sender?.user_id;
  const userId = typeof rawUserId === "number" || typeof rawUserId === "string" ? String(rawUserId) : "";
  let command = "";
  if (type === "bot_started") command = "/start";
  if (type === "message_created" && message) {
    const recipient = message.recipient as Record<string, unknown> | undefined;
    // Never answer in groups or channels: commands can expose private account details.
    if (recipient?.chat_type === "dialog" && sender?.is_bot !== true) {
      const body = message.body as Record<string, unknown> | undefined;
      command = typeof body?.text === "string" ? body.text.slice(0, 100) : "";
    }
  }
  try {
    if (userId && /^\d+$/u.test(userId)) {
      if (type === "bot_started" || command.trim().toLowerCase().split(/\s/u)[0] === "/start") await prisma.user.updateMany({ where: { maxUserId: userId }, data: { maxBotStartedAt: new Date() } });
      const user = await prisma.user.findFirst({ where: { maxUserId: userId }, select: { id: true } });
      if (user && command) await sendBotCommand(user.id, command, eventId);
      else if (!user && command) {
        const action = command.trim().toLocaleLowerCase("ru-RU").replace(/^[^\p{L}/]+/u, "").trim();
        const text = action === "/start" ? startText : action === "о вайбе" || action === "/about" ? aboutText : action === "поддержка" || action === "/support" ? supportText : "👋 Твой профиль ВАЙБА пока не настроен.\n\nЧтобы увидеть свою школу, уровень, Эйнштейны и личный прогресс, открой мини-приложение и заверши регистрацию.\n\n👇 Нажми «Открыть Вайб», чтобы продолжить.";
        const reply: BotReply = { text, buttons: mainMenuButtons() };
        await prisma.outbox.upsert({ where: { dedupeKey: `max:onboarding:${eventId}` }, create: { dedupeKey: `max:onboarding:${eventId}`, transport: "max", recipient: userId, body: JSON.stringify(reply) }, update: {} });
      }
    }
    if (typeof callback?.callback_id === "string" && isMaxEnabled() && process.env.MAX_BOT_TOKEN) await new MaxApiClient(process.env.MAX_BOT_TOKEN).answerCallback(callback.callback_id).catch(() => undefined);
    await prisma.botEvent.update({ where: { eventId }, data: { status: "PROCESSED" } });
  } catch (error) {
    await prisma.botEvent.update({ where: { eventId }, data: { status: "RECEIVED" } }).catch(() => undefined);
    throw error;
  }
}

export async function pollMaxUpdatesOnce() {
  if (polling) return;
  if (!isMaxEnabled() || !process.env.MAX_BOT_TOKEN || process.env.MAX_TRANSPORT !== "max" || process.env.NODE_ENV === "production") {
    pollingStatus.enabled = false;
    return;
  }
  polling = true;
  pollingStatus.enabled = true;
  try {
    const apiBase = new URL(maxApiBaseUrl());
    const headers = { Authorization: process.env.MAX_BOT_TOKEN };
    if (!subscriptionsChecked) {
      const subscriptionsResponse = await fetch(new URL("/subscriptions", apiBase), { headers, signal: AbortSignal.timeout(10_000) });
      if (!subscriptionsResponse.ok) throw new Error(`Не удалось проверить подписки MAX (HTTP ${subscriptionsResponse.status})`);
      const result = await subscriptionsResponse.json() as { subscriptions?: unknown[] };
      subscriptionsChecked = true;
      pollingStatus.checked = true;
      pollingStatus.webhookConflict = Boolean(result.subscriptions?.length);
      if (pollingStatus.webhookConflict) {
        pollingStatus.lastError = "Найдена активная webhook-подписка; локальный long polling остановлен без изменения подписки.";
        return;
      }
    }
    if (pollingStatus.webhookConflict) return;
    const markerRow = await prisma.botCursor.findUnique({ where: { key: "max_updates_marker" } });
    const query = new URLSearchParams({ timeout: "10", limit: "100" });
    if (markerRow?.value) query.set("marker", markerRow.value);
    const response = await fetch(new URL(`/updates?${query.toString()}`, apiBase), { headers, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Получение обновлений MAX завершилось с HTTP ${response.status}`);
    const page = await response.json() as { updates?: Array<Record<string, unknown>>; marker?: number | string | null };
    for (const update of page.updates ?? []) await handleMaxUpdate(update);
    if (page.marker !== undefined && page.marker !== null) await prisma.botCursor.upsert({ where: { key: "max_updates_marker" }, create: { key: "max_updates_marker", value: String(page.marker) }, update: { value: String(page.marker) } });
    pollingStatus.lastPollAt = new Date().toISOString();
    pollingStatus.lastError = null;
  } catch (error) {
    pollingStatus.lastError = "Не удалось получить обновления MAX. Проверьте серверную конфигурацию.";
    throw error;
  } finally { polling = false; }
}
