import { randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "./db.js";
import { browserCookie, clearSessionCookies, isTestLoginEnabled, issueSession, sha256, validateMaxInitData } from "./security.js";
import { isMaxConfigured, isMaxEnabled, maxConfigStatus } from "./max-service.js";

const iso = (date: Date | null) => date?.toISOString() ?? null;
const testLoginSchema = z.object({ profileKey: z.enum(["user-1", "user-2", "user-3", "user-4"]) }).strict();
const challengeSchema = z.object({ code: z.string().trim().min(4).max(12), initData: z.string().min(1).max(16_384) });
const compareCode = (candidate: string, storedHash: string | null, legacyCode: string) => {
  const expected = Buffer.from(storedHash ?? sha256(legacyCode.toUpperCase()), "hex");
  const actual = Buffer.from(sha256(candidate.trim().toUpperCase()), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};
const testProfiles = [
  { key: "user-1", name: "Пользователь 1", role: "STUDENT", className: "7A" },
  { key: "user-2", name: "Пользователь 2", role: "TEACHER", className: "7A" },
  { key: "user-3", name: "Пользователь 3", role: "SCHOOL_ADMIN", className: "7A" },
  { key: "user-4", name: "Пользователь 4", role: "PROJECT_OWNER", className: null },
] as const;

async function discardCurrentSession(request: FastifyRequest) {
  const token = request.cookies.vibe_session;
  if (token) await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
}

async function upsertMaxUser(identity: NonNullable<ReturnType<typeof validateMaxInitData>>) {
  const now = new Date();
  const existing = await prisma.user.findUnique({ where: { maxUserId: identity.maxUserId } });
  // An authenticated MAX user may have started the bot before their account existed.
  const earlierStart = existing?.maxBotStartedAt ? null : await prisma.outbox.findFirst({ where: { transport: "max", recipient: identity.maxUserId, dedupeKey: { startsWith: "max:onboarding:" } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
  const avatarWasMaxSynced = existing?.avatarUrl && (existing.avatarUrl === existing.maxAvatarUrl || existing.avatarUrl === existing.maxFullAvatarUrl);
  const maxAvatar = identity.fullAvatarUrl ?? identity.avatarUrl;
  const profileAvatar = existing?.avatarUrl && !avatarWasMaxSynced ? existing.avatarUrl : maxAvatar;
  const synced = {
    firstName: identity.firstName,
    lastName: identity.lastName,
    username: identity.username,
    avatarUrl: profileAvatar,
    maxFirstName: identity.firstName,
    maxLastName: identity.lastName,
    maxUsername: identity.username,
    maxAvatarUrl: identity.avatarUrl,
    maxFullAvatarUrl: identity.fullAvatarUrl,
    maxLinkedAt: existing?.maxLinkedAt ?? now,
    maxLastSyncAt: now,
    ...(earlierStart ? { maxBotStartedAt: earlierStart.createdAt } : {}),
  };
  let user = existing ? await prisma.user.update({ where: { id: existing.id }, data: synced }) : null;
  if (!user) {
    try { user = await prisma.user.create({ data: { maxUserId: identity.maxUserId, ...synced } }); }
    catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "P2002") throw error;
      const collided = await prisma.user.findUnique({ where: { maxUserId: identity.maxUserId } });
      if (!collided) throw error;
      user = await prisma.user.update({ where: { id: collided.id }, data: synced });
    }
  }
  await prisma.profileAppearance.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} });
  await prisma.userPreferences.upsert({ where: { userId: user.id }, create: { userId: user.id, maxNotificationsEnabled: true }, update: {} });
  return user;
}

export async function registerAuthRoutes(app: FastifyInstance) {
  app.get("/api/auth/test/profiles", async (_request, reply) => {
    if (!isTestLoginEnabled()) return reply.code(404).send({ error: "Локальный вход выключен" });
    const users = await prisma.user.findMany({
      where: { testProfileKey: { in: testProfiles.map((profile) => profile.key) }, maxUserId: null, isBlocked: false },
      include: { memberships: { where: { active: true, approved: true }, include: { school: true, schoolClass: true }, take: 1 }, _count: { select: { memberships: true } } },
    });
    return testProfiles.map((profile) => {
      const user = users.find((candidate) => candidate.testProfileKey === profile.key);
      const membership = user?.memberships[0];
      const isOwner = profile.role === "PROJECT_OWNER";
      const correctRole = isOwner ? user?.platformRole === "PROJECT_OWNER" && user._count.memberships === 0 && membership === undefined : membership?.role === profile.role && !user?.platformRole && (profile.role !== "TEACHER" || membership.isTeacher) && (profile.role !== "SCHOOL_ADMIN" || membership.isSchoolAdmin);
      const correctClass = isOwner ? !membership : membership?.schoolClass?.name === profile.className;
      return { key: profile.key, name: profile.name, role: profile.role, className: membership?.schoolClass?.name ?? null, schoolName: membership?.school.name ?? null, available: Boolean(user && !user.maxUserId && !user.isBlocked && correctRole && correctClass) };
    });
  });

  app.post("/api/auth/test/session", async (request, reply) => {
    if (!isTestLoginEnabled()) return reply.code(404).send({ error: "Локальный вход выключен" });
    const parsed = testLoginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Выберите один из четырёх подготовленных профилей" });
    const profile = testProfiles.find((item) => item.key === parsed.data.profileKey)!;
    const user = await prisma.user.findFirst({
      where: { testProfileKey: profile.key, maxUserId: null, platformRole: profile.role === "PROJECT_OWNER" ? "PROJECT_OWNER" : null, isBlocked: false },
      include: { memberships: { where: { active: true, approved: true }, include: { schoolClass: true }, take: 1 }, _count: { select: { memberships: true } } },
    });
    const membership = user?.memberships[0];
    const isOwner = profile.role === "PROJECT_OWNER";
    const correctRole = isOwner ? user?.platformRole === "PROJECT_OWNER" && user._count.memberships === 0 : membership?.role === profile.role && !user?.platformRole && (profile.role !== "TEACHER" || membership.isTeacher) && (profile.role !== "SCHOOL_ADMIN" || membership.isSchoolAdmin);
    const correctClass = isOwner ? !membership : membership?.schoolClass?.name === profile.className;
    if (!user || (!isOwner && !membership) || !correctRole || !correctClass) return reply.code(503).send({ error: `${profile.name} не подготовлен в отдельной презентационной базе` });
    await discardCurrentSession(request);
    await issueSession(user.id, reply, "TEST");
    const redirectTo = profile.role === "TEACHER" ? "/teacher" : profile.role === "SCHOOL_ADMIN" ? "/admin" : profile.role === "PROJECT_OWNER" ? "/owner/schools" : "/tasks";
    return { ok: true, source: "TEST", profile: profile.name, redirectTo };
  });

  app.get("/api/auth/status", async () => ({
    maxConfigured: isMaxEnabled() && isMaxConfigured(),
    botUsernameConfigured: Boolean(maxConfigStatus().username),
    testLoginEnabled: isTestLoginEnabled(),
    demoMode: process.env.NODE_ENV !== "production" && process.env.DEMO_MODE === "true",
    maxAppConfigured: isMaxEnabled() && isMaxConfigured() && Boolean(maxConfigStatus().username && maxConfigStatus().miniAppUrlValid),
  }));

  app.post("/api/auth/max", async (request, reply) => {
    if (!isMaxEnabled() || !isMaxConfigured()) return reply.code(503).send({ error: "Вход MAX сейчас отключён. Владелец должен включить интеграцию и настроить серверные параметры." });
    const body = z.object({ initData: z.string().min(1).max(16_384) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Передайте строку initData из MAX Bridge" });
    const identity = validateMaxInitData(body.data.initData, process.env.MAX_BOT_TOKEN ?? "");
    if (!identity) return reply.code(401).send({ error: "Подпись или срок данных MAX не прошли проверку" });
    const user = await upsertMaxUser(identity);
    if (user.isBlocked) return reply.code(403).send({ error: "Доступ к аккаунту закрыт" });
    await discardCurrentSession(request);
    await issueSession(user.id, reply);
    return { ok: true };
  });

  app.post("/api/auth/challenges", async (request, reply) => {
    const config = maxConfigStatus();
    if (!isMaxEnabled() || !isMaxConfigured() || !config.username || !config.miniAppUrlValid || !config.botUrl) return reply.code(503).send({ error: "Вход из браузера пока недоступен: владелец должен включить MAX, указать токен, имя бота и HTTPS-адрес Mini App." });
    const id = randomBytes(20).toString("base64url");
    const browserSecret = randomBytes(32).toString("base64url");
    const code = randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    await prisma.loginChallenge.create({ data: { id, code: "", codeHash: sha256(code), browserHash: sha256(browserSecret), expiresAt } });
    reply.setCookie(browserCookie, browserSecret, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 5 * 60 });
    const deepLink = new URL(config.botUrl);
    deepLink.searchParams.set("startapp", `vibe_${id}`);
    return { id, code, expiresAt: iso(expiresAt), deepLink: deepLink.toString() };
  });

  app.get<{ Params: { id: string } }>("/api/auth/challenges/:id", async (request, reply) => {
    const secret = request.cookies[browserCookie];
    const challenge = await prisma.loginChallenge.findUnique({ where: { id: request.params.id } });
    if (!challenge || !secret || challenge.browserHash !== sha256(secret)) return reply.code(404).send({ error: "Вход не найден" });
    const status = challenge.cancelledAt ? "CANCELLED" : challenge.consumedAt ? "CONSUMED" : challenge.expiresAt <= new Date() ? "EXPIRED" : challenge.confirmedAt ? "CONFIRMED" : "PENDING";
    return { status, confirmed: status === "CONFIRMED", expiresAt: iso(challenge.expiresAt) };
  });

  app.post<{ Params: { id: string } }>("/api/auth/challenges/:id/cancel", { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } }, async (request, reply) => {
    const secret = request.cookies[browserCookie];
    const challenge = await prisma.loginChallenge.findUnique({ where: { id: request.params.id } });
    if (!challenge) return reply.code(404).send({ error: "Вход не найден" });
    const browserMatches = Boolean(secret && challenge.browserHash === sha256(secret));
    if (!browserMatches) {
      const parsed = challengeSchema.safeParse(request.body);
      if (!parsed.success || !isMaxEnabled() || !isMaxConfigured()) return reply.code(404).send({ error: "Вход не найден в этом браузере" });
      const identity = validateMaxInitData(parsed.data.initData, process.env.MAX_BOT_TOKEN!);
      const startParam = new URLSearchParams(parsed.data.initData).get("start_param");
      if (!identity || startParam !== `vibe_${request.params.id}` || !compareCode(parsed.data.code, challenge.codeHash, challenge.code)) return reply.code(403).send({ error: "Подписанные данные MAX или код сверки не совпали" });
    }
    const cancelled = await prisma.loginChallenge.updateMany({ where: { id: challenge.id, expiresAt: { gt: new Date() }, confirmedAt: null, consumedAt: null, cancelledAt: null }, data: { cancelledAt: new Date() } });
    if (browserMatches) reply.clearCookie(browserCookie, { path: "/" });
    if (!cancelled.count) return reply.code(409).send({ error: "Вход уже подтверждён, отменён или истёк" });
    return { status: "CANCELLED" };
  });

  app.post<{ Params: { id: string } }>("/api/auth/challenges/:id/confirm", { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } }, async (request, reply) => {
    if (!isMaxEnabled() || !isMaxConfigured()) return reply.code(503).send({ error: "Вход MAX сейчас отключён. Владелец должен включить интеграцию." });
    const parsed = challengeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Введите код из исходного браузера и передайте initData MAX" });
    const identity = validateMaxInitData(parsed.data.initData, process.env.MAX_BOT_TOKEN!);
    if (!identity) return reply.code(401).send({ error: "Подпись или срок данных MAX не прошли проверку" });
    const startParam = new URLSearchParams(parsed.data.initData).get("start_param");
    if (startParam !== `vibe_${request.params.id}`) return reply.code(403).send({ error: "Ссылка MAX не связана с этим кодом входа" });
    const challenge = await prisma.loginChallenge.findUnique({ where: { id: request.params.id } });
    if (!challenge || challenge.expiresAt <= new Date() || challenge.consumedAt || challenge.confirmedAt || challenge.cancelledAt) return reply.code(410).send({ error: "Код входа уже использован, отменён или истёк" });
    if (!compareCode(parsed.data.code, challenge.codeHash, challenge.code)) return reply.code(403).send({ error: "Код подтверждения не совпадает. Сверьте его в исходном браузере и попробуйте ещё раз." });
    const user = await upsertMaxUser(identity);
    if (user.isBlocked) return reply.code(403).send({ error: "Доступ к аккаунту закрыт" });
    const confirmed = await prisma.loginChallenge.updateMany({ where: { id: challenge.id, confirmedAt: null, cancelledAt: null, consumedAt: null, expiresAt: { gt: new Date() } }, data: { maxUserId: identity.maxUserId, confirmedAt: new Date() } });
    if (confirmed.count !== 1) return reply.code(409).send({ error: "Код входа уже подтвердили в другом запросе" });
    return { ok: true, firstName: identity.firstName };
  });

  app.post<{ Params: { id: string } }>("/api/auth/challenges/:id/exchange", async (request, reply) => {
    const secret = request.cookies[browserCookie];
    const challenge = await prisma.loginChallenge.findUnique({ where: { id: request.params.id } });
    if (!challenge || !secret || challenge.browserHash !== sha256(secret)) return reply.code(404).send({ error: "Этот браузер не начинал вход" });
    if (!challenge.confirmedAt || !challenge.maxUserId || challenge.cancelledAt || challenge.expiresAt <= new Date() || challenge.consumedAt) return reply.code(410).send({ error: "Вход не подтверждён или код уже использован" });
    const consumed = await prisma.loginChallenge.updateMany({ where: { id: challenge.id, cancelledAt: null, consumedAt: null, confirmedAt: { not: null }, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
    if (consumed.count !== 1) return reply.code(409).send({ error: "Код уже использован" });
    const user = await prisma.user.findUnique({ where: { maxUserId: challenge.maxUserId } });
    if (!user || user.isBlocked) return reply.code(403).send({ error: "Доступ к аккаунту закрыт" });
    await discardCurrentSession(request);
    await issueSession(user.id, reply);
    reply.clearCookie(browserCookie, { path: "/" });
    return { ok: true };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const token = request.cookies.vibe_session;
    if (token) await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
    clearSessionCookies(reply);
    return { ok: true };
  });
}
