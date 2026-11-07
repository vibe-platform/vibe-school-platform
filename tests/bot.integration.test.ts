import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../apps/api/src/app.js";
import { dispatchBotOutboxBatch, handleBotCommand, handleMaxUpdate } from "../apps/api/src/bot.js";
import { MaxApiClient } from "../apps/api/src/max-service.js";
import { prisma } from "../apps/api/src/db.js";
import { enqueueNotification } from "../apps/api/src/notifications.js";

function cookieHeader(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value : value ? [value] : []).map((row) => row.split(";", 1)[0]).filter((row) => row.includes("=")).join("; ");
}
function csrf(cookie: string) { return cookie.split("; ").find((value) => value.startsWith("vibe_csrf="))?.slice("vibe_csrf=".length) ?? ""; }

describe("MAX bot commands, mock transport and retry safety", () => {
  const restore = new Map<string, string | undefined>();
  let app: Awaited<ReturnType<typeof buildApp>>;
  let studentId = "";
  let studentCookie = "";
  let maxUserId = "";
  let originalMaxUserId: string | null = null;
  let originalBotStartedAt: Date | null = null;

  beforeAll(async () => {
    for (const key of ["MAX_BOT_ENABLED", "MAX_BOT_TOKEN", "MAX_BOT_USERNAME", "MAX_BOT_URL", "MAX_MINI_APP_URL", "MAX_TRANSPORT", "PUBLIC_APP_URL", "MAX_API_BASE_URL"]) restore.set(key, process.env[key]);
    process.env.MAX_BOT_ENABLED = "false";
    process.env.MAX_BOT_TOKEN = "";
    process.env.MAX_TRANSPORT = "mock";
    process.env.MAX_BOT_USERNAME = "unit_bot";
    process.env.MAX_BOT_URL = "https://max.ru/unit_bot";
    delete process.env.MAX_MINI_APP_URL;
    process.env.PUBLIC_APP_URL = "http://127.0.0.1:5174";
    delete process.env.MAX_API_BASE_URL;
    app = await buildApp();
    const login = await app.inject({ method: "POST", url: "/api/auth/test/session", payload: { profileKey: "user-1" } });
    studentCookie = cookieHeader(login.headers["set-cookie"]);
    const student = await prisma.user.findUniqueOrThrow({ where: { testProfileKey: "user-1" }, select: { id: true, maxUserId: true, maxBotStartedAt: true } });
    studentId = student.id;
    originalMaxUserId = student.maxUserId;
    originalBotStartedAt = student.maxBotStartedAt;
    maxUserId = String(700_000_000_000_000 + Math.floor(Math.random() * 1_000_000));
  });

  afterAll(async () => {
    if (app) await app.close();
    if (studentId) await prisma.user.update({ where: { id: studentId }, data: { maxUserId: originalMaxUserId, maxBotStartedAt: originalBotStartedAt } });
    if (maxUserId) await prisma.outbox.deleteMany({ where: { recipient: maxUserId } });
    for (const [key, value] of restore) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });

  it("covers start, help, tasks, profile, market, customize, settings, FAQ, balance and unknown commands", async () => {
    const start = await handleBotCommand(studentId, "/start");
    expect(start.text).toContain("Добро пожаловать в ВАЙБ");
    expect(start.buttons?.map((button) => button.text)).toEqual(["🚀 Открыть Вайб", "👤 Профиль", "💡 О Вайбе", "✉️ Поддержка"]);
    expect(start.buttons?.[0]?.type).toBe("open_app");

    const expectedLinks: Array<[string, string]> = [
      ["/tasks", "/tasks"], ["/market", "/market"],
      ["/customize", "/profile/customize"], ["/settings", "/profile#settings"], ["/faq", "/faq"],
    ];
    for (const [command, path] of expectedLinks) {
      const reply = await handleBotCommand(studentId, command);
      expect(reply.link).toBe(`http://127.0.0.1:5174${path}`);
      expect(reply.text.length).toBeGreaterThan(0);
    }
    expect((await handleBotCommand(studentId, "/tasks today")).link).toBe("http://127.0.0.1:5174/tasks");
    expect((await handleBotCommand(studentId, "/profile")).text).toContain("МОЙ ПРОФИЛЬ");
    expect((await handleBotCommand(studentId, "О Вайбе")).text).toContain("ЧТО ТАКОЕ ВАЙБ");
    expect((await handleBotCommand(studentId, "Поддержка")).text).toContain("vaibe32@mail.ru");
    expect((await handleBotCommand(studentId, "/help")).text).toContain("/faq");
    expect((await handleBotCommand(studentId, "/faq")).text.length).toBeLessThanOrEqual(3500);
    expect((await handleBotCommand(studentId, "/balance")).text).toMatch(/Ваш баланс: \d+ Эйнштейнов/u);
    expect((await handleBotCommand(studentId, "/unknown")).text).toContain("Команды:");

    const teacher = await prisma.user.findUniqueOrThrow({ where: { testProfileKey: "user-2" }, select: { id: true } });
    expect((await handleBotCommand(teacher.id, "/balance")).text).toBe("Баланс ученика недоступен служебным аккаунтам.");
    expect((await handleBotCommand("missing-test-user", "/start")).text).toContain("Откройте Вайб и войдите заново");
  });

  it("serves mock commands through the local API, stores a private log, and requires CSRF", async () => {
    const noCsrf = await app.inject({ method: "POST", url: "/api/bot/mock-command", headers: { cookie: studentCookie }, payload: { command: "/profile" } });
    expect(noCsrf.statusCode).toBe(403);
    const response = await app.inject({ method: "POST", url: "/api/bot/mock-command", headers: { cookie: studentCookie, "x-csrf-token": csrf(studentCookie) }, payload: { command: "/profile" } });
    expect(response.statusCode).toBe(200);
    expect(response.json().text).toContain("МОЙ ПРОФИЛЬ");
    expect(response.json().link).toBeUndefined();
    const log = await app.inject({ method: "GET", url: "/api/bot/mock-log", headers: { cookie: studentCookie } });
    expect(log.statusCode).toBe(200);
    expect(log.json().messages.slice(-2).map((message: { direction: string }) => message.direction)).toEqual(["IN", "OUT"]);
    expect(log.json().messages.at(-1).text).toContain("МОЙ ПРОФИЛЬ");
  });

  it("returns the approved complete texts and the actual student profile", async () => {
    expect((await handleBotCommand(studentId, "/start")).text.replace(/\r\n/gu, "\n")).toBe("👋 Привет! Добро пожаловать в ВАЙБ!\n\nШкольная жизнь интереснее, когда знания превращаются в возможности.\n\nВАЙБ — это пространство, где твои достижения, инициативы и интересы помогают открывать новые горизонты.\n\nЗдесь ты сможешь следить за своим прогрессом, участвовать в активностях, зарабатывать Эйнштейны и открывать доступ к новым возможностям.\n\nТвой путь — твои интересы — твой ВАЙБ.\n\nДавай познакомимся поближе и настроим твой профиль. Это займёт всего пару минут.\n\n👇 Начнём?");
    expect((await handleBotCommand(studentId, "О Вайбе")).text.replace(/\r\n/gu, "\n")).toBe("💡 ЧТО ТАКОЕ ВАЙБ?\n\nВАЙБ — это цифровая система образовательной мотивации, которая помогает превращать учебную и внеучебную активность в новые возможности.\n\nМы верим, что образование — это не только оценки. Это знания, инициативы, интересы, личные достижения и опыт, который помогает человеку развиваться.\n\n🚀 КАК ЭТО РАБОТАЕТ?\n\n1. Действуй.\n\nУчаствуй в образовательных мероприятиях, развивай свои навыки, проявляй инициативу и пробуй новое.\n\n2. Развивайся.\n\nОтслеживай собственный прогресс, открывай достижения и двигайся к личным целям.\n\n3. Получай Эйнштейны.\n\nВнутренняя валюта ВАЙБА позволяет учитывать твою активность и открывает доступ к предусмотренным системой возможностям.\n\n4. Открывай новое.\n\nИспользуй доступные возможности, знакомься с инициативами партнёров и находи направления для дальнейшего развития.\n\n✨ НАША ИДЕЯ\n\nВАЙБ — не гонка за чужими результатами. Здесь важно не то, насколько ты опережаешь других, а то, как ты развиваешься сам.\n\nМы хотим, чтобы образование давало не только знания, но и реальные возможности применять их на практике.\n\n🎯 ТВОЙ ПУТЬ. ТВОИ ИНТЕРЕСЫ. ТВОЙ ВАЙБ.\n\nДобро пожаловать в пространство, где твоя активность может стать началом новых достижений!");
    expect((await handleBotCommand(studentId, "Поддержка")).text.replace(/\r\n/gu, "\n")).toBe("🛟 ПОДДЕРЖКА ВАЙБА\n\nВозник вопрос, что-то не работает или нужна помощь с использованием ВАЙБА?\n\nМы постараемся помочь!\n\n📩 Наша электронная почта:\n\nvaibe32@mail.ru\n\nЧтобы мы быстрее разобрались в ситуации, расскажи:\n\n• Что именно произошло?\n\n• В каком разделе возникла проблема?\n\n• Что ты пытался сделать?\n\nЕсли возможно, приложи скриншот ошибки, предварительно скрыв личные данные.\n\n🔐 Никогда не отправляй пароли, коды подтверждения или другие секретные данные.\n\n💜 Спасибо, что помогаешь делать ВАЙБ лучше!");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: studentId }, include: { memberships: { where: { active: true, approved: true }, include: { school: true, schoolClass: true }, take: 1 } } });
    const member = user.memberships[0]!;
    const profile = await handleBotCommand(studentId, "Профиль");
    expect(profile.link).toBeUndefined();
    expect(profile.text).toContain(member.school.name);
    expect(profile.text).toContain(member.schoolClass!.name);
    expect(profile.text).toContain(`Эйнштейны: ${member.balance}`);
    expect(profile.text).toContain(`Опыт: ${member.totalExp}`);
    expect(profile.text).not.toMatch(/undefined|null/u);
  });

  it("points each role to an accessible next action", async () => {
    for (const [profileKey, expected] of [["user-1", null], ["user-2", "/teacher"], ["user-3", "/admin"], ["user-4", "/owner"]] as const) {
      const login = await app.inject({ method: "POST", url: "/api/auth/test/session", payload: { profileKey } });
      const response = await app.inject({ method: "GET", url: "/api/tasks", headers: { cookie: cookieHeader(login.headers["set-cookie"]) } });
      expect(response.statusCode).toBe(200);
      if (expected) expect(response.json().nextAction.href).toBe(expected);
      else expect(response.json().nextAction.href).not.toBe("/teacher");
    }
  });

  it("serializes the native MAX mini app button", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      await new MaxApiClient("test-token").sendMessage("123", { text: "start", buttons: [{ type: "open_app", text: "Открыть Вайб" }] });
      const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
      const body = JSON.parse(String(init.body));
      expect(body.attachments[0].payload.buttons[0][0]).toMatchObject({ type: "open_app", text: "Открыть Вайб" });
    } finally { globalThis.fetch = originalFetch; }
  });

  it("queues one task notification with the native app button", async () => {
    const key = `task:assigned:isolated:${Date.now()}`;
    await enqueueNotification({ userId: studentId, eventKey: key, kind: "TASKS", title: "Новое задание", body: "Тестовое задание", link: "https://example.invalid/task" });
    await enqueueNotification({ userId: studentId, eventKey: key, kind: "TASKS", title: "Новое задание", body: "Тестовое задание", link: "https://example.invalid/task" });
    const rows = await prisma.outbox.findMany({ where: { dedupeKey: `notification:${key}` } });
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.body).buttons[0].type).toBe("open_app");
  });

  it("delivers task notifications to the bound MAX recipient once and honours disabled preferences", async () => {
    const oldFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    const previous = { enabled: process.env.MAX_BOT_ENABLED, token: process.env.MAX_BOT_TOKEN, transport: process.env.MAX_TRANSPORT };
    const originalUser = await prisma.user.findUniqueOrThrow({ where: { id: studentId } });
    const originalPrefs = await prisma.userPreferences.findUniqueOrThrow({ where: { userId: studentId } });
    const member = await prisma.membership.findFirstOrThrow({ where: { userId: studentId, active: true, approved: true } });
    const author = await prisma.user.findUniqueOrThrow({ where: { testProfileKey: "user-2" } });
    const assignment = await prisma.assignment.create({ data: { schoolId: member.schoolId, teacherId: author.id, title: "Тест уведомления", subject: "Тест", category: "Учёба", description: "Тест", published: true } });
    const key = `task:assigned:${assignment.id}:${Date.now()}`;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      process.env.MAX_BOT_ENABLED = "true"; process.env.MAX_BOT_TOKEN = "unit-token"; process.env.MAX_TRANSPORT = "max";
      await prisma.user.update({ where: { id: studentId }, data: { maxUserId, maxBotStartedAt: new Date() } });
      await prisma.userPreferences.update({ where: { userId: studentId }, data: { notifyTasks: true, maxNotificationsEnabled: true, maxNotifyNewTasks: true, quietHoursEnabled: false } });
      const event = { userId: studentId, eventKey: key, kind: "TASKS" as const, title: "Новое задание", body: "Тест" };
      await enqueueNotification(event); await enqueueNotification(event);
      expect(await dispatchBotOutboxBatch()).toBeGreaterThanOrEqual(1);
      const row = await prisma.outbox.findUniqueOrThrow({ where: { dedupeKey: `notification:${key}` } });
      expect(row.status).toBe("SENT"); expect(row.recipient).toBe(maxUserId);
      expect(fetchMock.mock.calls).toHaveLength(1);
      expect(String((fetchMock.mock.calls[0] as unknown as [string])[0])).toContain(`user_id=${maxUserId}`);
      await prisma.userPreferences.update({ where: { userId: studentId }, data: { maxNotifyNewTasks: false } });
      await enqueueNotification({ ...event, eventKey: `${key}:disabled` });
      expect(await prisma.outbox.findUnique({ where: { dedupeKey: `notification:${key}:disabled` } })).toBeNull();
    } finally {
      globalThis.fetch = oldFetch;
      process.env.MAX_BOT_ENABLED = previous.enabled; process.env.MAX_BOT_TOKEN = previous.token; process.env.MAX_TRANSPORT = previous.transport;
      await prisma.user.update({ where: { id: studentId }, data: { maxUserId: originalUser.maxUserId, maxBotStartedAt: originalUser.maxBotStartedAt } });
      await prisma.userPreferences.update({ where: { userId: studentId }, data: { notifyTasks: originalPrefs.notifyTasks, maxNotificationsEnabled: originalPrefs.maxNotificationsEnabled, maxNotifyNewTasks: originalPrefs.maxNotifyNewTasks, quietHoursEnabled: originalPrefs.quietHoursEnabled } });
      await prisma.assignment.delete({ where: { id: assignment.id } });
    }
  });

  it("shows the current real balance for a school administrator", async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { testProfileKey: "user-3" }, include: { memberships: { where: { active: true, approved: true }, take: 1 } } });
    const membership = admin.memberships[0]!;
    try {
      await prisma.membership.update({ where: { id: membership.id }, data: { balance: 23 } });
      expect((await handleBotCommand(admin.id, "Профиль")).text).toContain("Эйнштейны: 23");
      await prisma.membership.update({ where: { id: membership.id }, data: { balance: 41 } });
      expect((await handleBotCommand(admin.id, "Профиль")).text).toContain("Эйнштейны: 41");
    } finally { await prisma.membership.update({ where: { id: membership.id }, data: { balance: membership.balance } }); }
  });

  it("handles bot start and replays in private chats once, while ignoring group commands", async () => {
    await prisma.user.update({ where: { id: studentId }, data: { maxUserId } });
    const beforeMessages = await prisma.botMessage.count({ where: { userId: studentId } });
    const beforeOutbox = await prisma.outbox.count({ where: { recipient: maxUserId } });
    const start = { update_type: "bot_started", timestamp: Date.now(), user: { user_id: Number(maxUserId), first_name: "Ученик" } };
    await handleMaxUpdate(start);
    await handleMaxUpdate(start);
    expect(await prisma.botMessage.count({ where: { userId: studentId } })).toBe(beforeMessages + 2);
    expect(await prisma.outbox.count({ where: { recipient: maxUserId } })).toBe(beforeOutbox + 1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: studentId } })).maxBotStartedAt).not.toBeNull();

    const group = { update_type: "message_created", timestamp: Date.now(), message: { sender: { user_id: Number(maxUserId) }, recipient: { chat_type: "chat" }, body: { mid: `group-${Date.now()}`, text: "/balance" } } };
    await handleMaxUpdate(group);
    expect(await prisma.botMessage.count({ where: { userId: studentId } })).toBe(beforeMessages + 2);
    expect(await prisma.outbox.count({ where: { recipient: maxUserId } })).toBe(beforeOutbox + 1);
  });

  it("pins the official API, keeps the token in Authorization, and schedules retry after API failure", async () => {
    const originalFetch = globalThis.fetch;
    const fakeFetch = vi.fn(async () => new Response("", { status: 503 }));
    globalThis.fetch = fakeFetch as unknown as typeof fetch;
    const testToken = "isolated-bot-test-token";
    try {
      await expect(new MaxApiClient(testToken).sendMessage("123456", { text: "Проверка", link: "https://vibe.example.invalid" })).rejects.toThrow("503");
      expect(fakeFetch).toHaveBeenCalledTimes(1);
      const [requestUrl, init] = fakeFetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(requestUrl).toBe("https://platform-api2.max.ru/messages?user_id=123456");
      expect(new Headers(init.headers).get("Authorization")).toBe(testToken);
      expect(requestUrl).not.toContain(testToken);
      expect(JSON.stringify(init.body)).not.toContain(testToken);

      process.env.MAX_BOT_ENABLED = "true";
      process.env.MAX_BOT_TOKEN = testToken;
      process.env.MAX_TRANSPORT = "max";
      const dedupeKey = `bot-retry-test:${Date.now()}`;
      const retry = await prisma.outbox.create({ data: { dedupeKey, transport: "max", recipient: "123456", body: JSON.stringify({ text: "Повторная отправка" }), status: "PENDING", nextAttemptAt: new Date(Date.now() - 1000) } });
      const attemptsBefore = fakeFetch.mock.calls.length;
      expect(await dispatchBotOutboxBatch()).toBe(0);
      const rescheduled = await prisma.outbox.findUniqueOrThrow({ where: { id: retry.id } });
      expect(rescheduled).toMatchObject({ status: "PENDING", attempts: 1 });
      expect(rescheduled.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
      expect(fakeFetch.mock.calls.length).toBe(attemptsBefore + 1);
      await prisma.outbox.delete({ where: { id: retry.id } });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
