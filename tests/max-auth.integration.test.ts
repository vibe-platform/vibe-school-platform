import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../apps/api/src/app.js";
import { prisma } from "../apps/api/src/db.js";
import { handleMaxUpdate } from "../apps/api/src/bot.js";

function signedInitData(token: string, maxUserId: string, startParam: string, profile: { first_name: string; last_name?: string | null; username?: string | null; photo_url?: string | null; full_avatar_url?: string | null }) {
  const userFields = [`"id":${maxUserId}`, `"first_name":${JSON.stringify(profile.first_name)}`];
  for (const [key, value] of [["last_name", profile.last_name], ["username", profile.username], ["photo_url", profile.photo_url], ["full_avatar_url", profile.full_avatar_url]] as const) if (value !== undefined) userFields.push(`${JSON.stringify(key)}:${JSON.stringify(value)}`);
  const user = `{${userFields.join(",")}}`;
  const entries = [["user", user], ["auth_date", String(Math.floor(Date.now() / 1000))], ["start_param", startParam]] as const;
  const dataCheck = [...entries].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secret).update(dataCheck).digest("hex");
  return `${entries.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&")}&hash=${hash}`;
}

function cookieHeader(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value : value ? [value] : []).map((row) => row.split(";", 1)[0]).filter((row) => row.includes("=")).join("; ");
}

describe("MAX login challenges and identity sync", () => {
  let app: FastifyInstance;
  const restore = new Map<string, string | undefined>();
  const token = "unit-only-max-token-not-a-real-secret";
  const maxUserId = String(8_765_432_100_001 + Math.floor(Math.random() * 100_000));
  let userId = "";

  beforeAll(async () => {
    for (const key of ["MAX_BOT_ENABLED", "MAX_BOT_TOKEN", "MAX_BOT_USERNAME", "MAX_BOT_URL", "MAX_MINI_APP_URL", "MAX_TRANSPORT", "MAX_WEBHOOK_SECRET"]) restore.set(key, process.env[key]);
    process.env.MAX_BOT_ENABLED = "true";
    process.env.MAX_BOT_TOKEN = token;
    process.env.MAX_BOT_USERNAME = "unit_bot";
    process.env.MAX_BOT_URL = "https://max.ru/unit_bot";
    process.env.MAX_MINI_APP_URL = "https://vibe.example.invalid";
    process.env.MAX_TRANSPORT = "mock";
    app = await buildApp();
  });

  afterAll(async () => {
    if (app) await app.close();
    await prisma.loginChallenge.deleteMany({ where: { maxUserId } });
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    for (const [key, value] of restore) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await prisma.$disconnect();
  });

  it("creates a one-use browser-bound challenge, confirms by signed Mini App data, and syncs profile safely", async () => {
    const begin = await app.inject({ method: "POST", url: "/api/auth/challenges" });
    expect(begin.statusCode).toBe(200);
    const challenge = begin.json() as { id: string; code: string; deepLink: string };
    const browserCookie = cookieHeader(begin.headers["set-cookie"]);
    expect(challenge.deepLink).toContain(`startapp=vibe_${challenge.id}`);
    const stored = await prisma.loginChallenge.findUniqueOrThrow({ where: { id: challenge.id } });
    expect(stored.code).toBe("");
    expect(stored.codeHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(stored.browserHash).not.toBe(browserCookie.split("=").at(-1));

    const initData = signedInitData(token, maxUserId, `vibe_${challenge.id}`, { first_name: "Тестовый", last_name: "Ученик", username: "first_name", photo_url: "https://cdn.max.example/small.png", full_avatar_url: "https://cdn.max.example/full.png" });
    const wrongBrowser = await app.inject({ method: "GET", url: `/api/auth/challenges/${challenge.id}`, headers: { cookie: "vibe_login_browser=not-the-owner" } });
    expect(wrongBrowser.statusCode).toBe(404);
    const badCode = await app.inject({ method: "POST", url: `/api/auth/challenges/${challenge.id}/confirm`, payload: { code: "000000", initData } });
    expect(badCode.statusCode).toBe(403);
    const confirmed = await app.inject({ method: "POST", url: `/api/auth/challenges/${challenge.id}/confirm`, payload: { code: challenge.code, initData } });
    expect(confirmed.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/auth/challenges/${challenge.id}`, headers: { cookie: browserCookie } })).json()).toMatchObject({ status: "CONFIRMED", confirmed: true });

    const exchange = await app.inject({ method: "POST", url: `/api/auth/challenges/${challenge.id}/exchange`, headers: { cookie: browserCookie } });
    expect(exchange.statusCode).toBe(200);
    const sessionCookie = cookieHeader(exchange.headers["set-cookie"]);
    const session = await app.inject({ method: "GET", url: "/api/session/me", headers: { cookie: sessionCookie } });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toMatchObject({ authenticated: true, user: { role: null, avatarUrl: "https://cdn.max.example/full.png", maxConnection: { connected: true, username: "first_name" } } });
    expect(JSON.stringify(session.json())).not.toContain(maxUserId);
    const synced = await prisma.user.findUniqueOrThrow({ where: { maxUserId } });
    userId = synced.id;
    expect((await prisma.userPreferences.findUniqueOrThrow({ where: { userId } })).maxNotificationsEnabled).toBe(true);
    await prisma.userPreferences.update({ where: { userId }, data: { maxNotificationsEnabled: false } });
    expect(synced.platformRole).toBeNull();
    expect(await prisma.membership.count({ where: { userId } })).toBe(0);

    await prisma.user.update({ where: { id: userId }, data: { avatarUrl: "https://user.example/custom.png" } });
    const refreshed = await app.inject({ method: "POST", url: "/api/auth/max", payload: { initData: signedInitData(token, maxUserId, "", { first_name: "Новое имя", last_name: null, username: null, photo_url: "https://cdn.max.example/new-small.png", full_avatar_url: "https://cdn.max.example/new-full.png" }) } });
    expect(refreshed.statusCode).toBe(200);
    expect((await prisma.userPreferences.findUniqueOrThrow({ where: { userId } })).maxNotificationsEnabled).toBe(false);
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(updated).toMatchObject({ firstName: "Новое имя", username: null, maxUsername: null, avatarUrl: "https://user.example/custom.png", maxFullAvatarUrl: "https://cdn.max.example/new-full.png" });
    expect((await app.inject({ method: "POST", url: `/api/auth/challenges/${challenge.id}/exchange`, headers: { cookie: browserCookie } })).statusCode).toBe(410);
  });

  it("preserves a bot start that happened before the first signed Mini App login", async () => {
    const newMaxId = String(BigInt(maxUserId) + 500000n);
    await handleMaxUpdate({ update_type: "bot_started", timestamp: Date.now(), user: { user_id: newMaxId } });
    expect(await prisma.user.findUnique({ where: { maxUserId: newMaxId } })).toBeNull();
    const initData = signedInitData(token, newMaxId, "", { first_name: "Новый" });
    expect((await app.inject({ method: "POST", url: "/api/auth/max", payload: { initData } })).statusCode).toBe(200);
    const account = await prisma.user.findUniqueOrThrow({ where: { maxUserId: newMaxId } });
    expect(account.maxBotStartedAt).not.toBeNull();
    expect((await app.inject({ method: "POST", url: "/api/auth/max", payload: { initData } })).statusCode).toBe(200);
    expect(await prisma.user.count({ where: { maxUserId: newMaxId } })).toBe(1);
    await prisma.user.delete({ where: { id: account.id } });
    await prisma.outbox.deleteMany({ where: { recipient: newMaxId } });
  });

  it("supports cancellation in the original browser and signed Mini App, and reports expiry", async () => {
    const browserStart = await app.inject({ method: "POST", url: "/api/auth/challenges" });
    const browserChallenge = browserStart.json() as { id: string };
    const browserCookie = cookieHeader(browserStart.headers["set-cookie"]);
    const cancelled = await app.inject({ method: "POST", url: `/api/auth/challenges/${browserChallenge.id}/cancel`, headers: { cookie: browserCookie } });
    expect(cancelled.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/auth/challenges/${browserChallenge.id}`, headers: { cookie: browserCookie } })).json()).toMatchObject({ status: "CANCELLED", confirmed: false });

    const miniAppStart = await app.inject({ method: "POST", url: "/api/auth/challenges" });
    const miniAppChallenge = miniAppStart.json() as { id: string; code: string };
    const miniAppData = signedInitData(token, maxUserId, `vibe_${miniAppChallenge.id}`, { first_name: "Тестовый" });
    const miniAppCancel = await app.inject({ method: "POST", url: `/api/auth/challenges/${miniAppChallenge.id}/cancel`, payload: { code: miniAppChallenge.code, initData: miniAppData } });
    expect(miniAppCancel.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/auth/challenges/${miniAppChallenge.id}`, headers: { cookie: cookieHeader(miniAppStart.headers["set-cookie"]) } })).json()).toMatchObject({ status: "CANCELLED" });

    const expiredStart = await app.inject({ method: "POST", url: "/api/auth/challenges" });
    const expired = expiredStart.json() as { id: string; code: string };
    await prisma.loginChallenge.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const expiredStatus = await app.inject({ method: "GET", url: `/api/auth/challenges/${expired.id}`, headers: { cookie: cookieHeader(expiredStart.headers["set-cookie"]) } });
    expect(expiredStatus.json()).toMatchObject({ status: "EXPIRED" });
    const initData = signedInitData(token, maxUserId, `vibe_${expired.id}`, { first_name: "Тестовый" });
    expect((await app.inject({ method: "POST", url: `/api/auth/challenges/${expired.id}/confirm`, payload: { code: expired.code, initData } })).statusCode).toBe(410);
  });

  it("authenticates MAX webhook requests, records bot start once, and replays events idempotently", async () => {
    process.env.MAX_WEBHOOK_SECRET = "unit-only-max-webhook-secret";
    const update = { update_type: "bot_started", timestamp: Date.now(), user: { user_id: maxUserId, first_name: "Тестовый" } };
    expect((await app.inject({ method: "POST", url: "/api/webhooks/max", headers: { "x-max-bot-api-secret": "wrong" }, payload: update })).statusCode).toBe(401);
    const beforeMessages = await prisma.botMessage.count({ where: { userId } });
    const beforeOutbox = await prisma.outbox.count({ where: { recipient: maxUserId } });
    const accepted = await app.inject({ method: "POST", url: "/api/webhooks/max", headers: { "x-max-bot-api-secret": process.env.MAX_WEBHOOK_SECRET }, payload: update });
    expect(accepted.statusCode).toBe(200);
    const started = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(started.maxBotStartedAt).not.toBeNull();
    const duplicate = await app.inject({ method: "POST", url: "/api/webhooks/max", headers: { "x-max-bot-api-secret": process.env.MAX_WEBHOOK_SECRET }, payload: update });
    expect(duplicate.statusCode).toBe(200);
    expect(await prisma.botMessage.count({ where: { userId } })).toBe(beforeMessages + 2);
    expect(await prisma.outbox.count({ where: { recipient: maxUserId } })).toBe(beforeOutbox + 1);
  });
});
