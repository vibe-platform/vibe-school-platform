import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../apps/api/src/app.js";
import { prisma } from "../apps/api/src/db.js";
import { randomBytes } from "node:crypto";
import { sha256 } from "../apps/api/src/security.js";

function cookies(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value : value ? [value] : []).map((item) => item.split(";", 1)[0]).filter((item) => item.includes("=")).join("; ");
}
function csrf(cookie: string) { return cookie.split("; ").find((value) => value.startsWith("vibe_csrf="))?.slice("vibe_csrf=".length) ?? ""; }

describe("published FAQ and owner MAX diagnostics", () => {
  let app: FastifyInstance;
  let ownerCookie = "";
  let testOwnerCookie = "";
  let studentCookie = "";
  let ownerUserId = "";
  const prefix = `Проверочный вопрос ${Date.now()}`;
  const restore = new Map<string, string | undefined>();

  beforeAll(async () => {
    for (const key of ["NODE_ENV", "ENABLE_TEST_LOGIN", "DEMO_MODE", "MAX_BOT_ENABLED", "MAX_BOT_TOKEN", "MAX_BOT_USERNAME", "MAX_BOT_URL", "MAX_MINI_APP_URL"]) restore.set(key, process.env[key]);
    process.env.NODE_ENV = "test";
    process.env.ENABLE_TEST_LOGIN = "true";
    process.env.DEMO_MODE = "false";
    process.env.MAX_BOT_ENABLED = "false";
    delete process.env.MAX_BOT_TOKEN;
    app = await buildApp();
    const owner = await prisma.user.create({ data: { maxUserId: `989${Date.now()}`, firstName: "Владелец", lastName: "Проверка", platformRole: "PROJECT_OWNER" } });
    ownerUserId = owner.id;
    const ownerToken = randomBytes(32).toString("base64url");
    const ownerCsrf = randomBytes(24).toString("base64url");
    await prisma.session.create({ data: { userId: owner.id, authSource: "MAX", tokenHash: sha256(ownerToken), expiresAt: new Date(Date.now() + 60_000) } });
    ownerCookie = `vibe_session=${ownerToken}; vibe_csrf=${ownerCsrf}`;
    const testOwner = await app.inject({ method: "POST", url: "/api/auth/test/session", payload: { profileKey: "user-4" } });
    testOwnerCookie = cookies(testOwner.headers["set-cookie"]);
    const student = await app.inject({ method: "POST", url: "/api/auth/test/session", payload: { profileKey: "user-1" } });
    studentCookie = cookies(student.headers["set-cookie"]);
  });

  afterAll(async () => {
    if (app) await app.close();
    await prisma.faqItem.deleteMany({ where: { question: { startsWith: prefix } } });
    if (ownerUserId) await prisma.user.deleteMany({ where: { id: ownerUserId } });
    for (const [key, value] of restore) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await prisma.$disconnect();
  });

  it("persists owner-created FAQ, publishes only explicit answers, filters, sorts, archives and restores safely", async () => {
    const draft = { question: `${prefix} черновик`, answer: "Проверенный ответ для изолированного теста.", category: "Проверка", isFeatured: false, isPublished: false, sortOrder: 20 };
    const create = await app.inject({ method: "POST", url: "/api/owner/faq", headers: { cookie: ownerCookie, "x-csrf-token": csrf(ownerCookie) }, payload: draft });
    expect(create.statusCode).toBe(201);
    const first = create.json() as { id: string };
    expect((await app.inject({ method: "GET", url: `/api/faq?q=${encodeURIComponent(prefix)}` })).json().items).toHaveLength(0);

    const secondCreate = await app.inject({ method: "POST", url: "/api/owner/faq", headers: { cookie: ownerCookie, "x-csrf-token": csrf(ownerCookie) }, payload: { ...draft, question: `${prefix} опубликован`, answer: "Короткий подтверждённый текст.", isFeatured: true, isPublished: true, sortOrder: 10 } });
    expect(secondCreate.statusCode).toBe(201);
    const second = secondCreate.json() as { id: string };
    const publicFaq = await app.inject({ method: "GET", url: `/api/faq?q=${encodeURIComponent(prefix)}&category=Проверка` });
    expect(publicFaq.statusCode).toBe(200);
    expect(publicFaq.json().items.map((item: { question: string }) => item.question)).toEqual([`${prefix} опубликован`]);

    const update = await app.inject({ method: "PATCH", url: `/api/owner/faq/${first.id}`, headers: { cookie: ownerCookie, "x-csrf-token": csrf(ownerCookie) }, payload: { isPublished: true } });
    expect(update.statusCode).toBe(200);
    const order = await app.inject({ method: "PUT", url: "/api/owner/faq-order", headers: { cookie: ownerCookie, "x-csrf-token": csrf(ownerCookie) }, payload: { ids: [first.id, second.id] } });
    expect(order.statusCode).toBe(200);
    expect((await prisma.faqItem.findUniqueOrThrow({ where: { id: first.id } })).sortOrder).toBe(0);
    expect((await app.inject({ method: "GET", url: `/api/faq?q=${encodeURIComponent(prefix)}` })).json().items).toHaveLength(2);

    const archived = await app.inject({ method: "POST", url: `/api/owner/faq/${second.id}/archive`, headers: { cookie: ownerCookie, "x-csrf-token": csrf(ownerCookie) } });
    expect(archived.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/faq?q=${encodeURIComponent(prefix)}` })).json().items).toHaveLength(1);
    const restored = await app.inject({ method: "POST", url: `/api/owner/faq/${second.id}/restore`, headers: { cookie: ownerCookie, "x-csrf-token": csrf(ownerCookie) } });
    expect(restored.statusCode).toBe(200);
    expect(await prisma.faqItem.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({ isPublished: false, archivedAt: null });
    expect((await app.inject({ method: "GET", url: `/api/faq?q=${encodeURIComponent(prefix)}` })).json().items).toHaveLength(1);

    const forbidden = await app.inject({ method: "POST", url: "/api/owner/faq", headers: { cookie: studentCookie, "x-csrf-token": csrf(studentCookie) }, payload: draft });
    expect(forbidden.statusCode).toBe(403);
    const demoQuestion = `${prefix} общий контур`;
    const demoCreate = await app.inject({ method: "POST", url: "/api/owner/faq", headers: { cookie: testOwnerCookie, "x-csrf-token": csrf(testOwnerCookie) }, payload: { ...draft, question: demoQuestion, isPublished: true } });
    expect(demoCreate.statusCode).toBe(201);
    expect(demoCreate.json()).toMatchObject({ question: demoQuestion, isSynthetic: false });
    expect((await app.inject({ method: "GET", url: `/api/faq?q=${encodeURIComponent(prefix)}` })).json().items.map((item: { question: string }) => item.question)).toContain(demoQuestion);
    expect((await app.inject({ method: "GET", url: `/api/faq?q=${encodeURIComponent(prefix)}`, headers: { cookie: testOwnerCookie } })).json().items.map((item: { question: string }) => item.question)).toEqual([`${prefix} черновик`, demoQuestion]);
    const ownerFaq = await app.inject({ method: "GET", url: "/api/owner/faq", headers: { cookie: ownerCookie } });
    expect(ownerFaq.json().some((item: { question: string }) => item.question === demoQuestion)).toBe(true);
  });

  it("keeps MAX diagnostics owner-only and safe when the integration is disabled", async () => {
    const status = await app.inject({ method: "GET", url: "/api/owner/max/status", headers: { cookie: ownerCookie } });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ status: "DISABLED", enabled: false, configured: false, tokenConfigured: false });
    const serialized = JSON.stringify(status.json());
                                                                                                    
    expect(status.json()).toHaveProperty("tokenConfigured", false);
    expect(serialized).not.toContain("test-only-max-secret");
    expect(status.json()).not.toHaveProperty("token");
    expect(status.json()).not.toHaveProperty("secret");
    const testOwnerStatus = await app.inject({ method: "GET", url: "/api/owner/max/status", headers: { cookie: testOwnerCookie } });
    expect(testOwnerStatus.statusCode).toBe(200);
    expect(testOwnerStatus.json()).toMatchObject({ status: "DISABLED", enabled: false, configured: false });
    expect((await app.inject({ method: "GET", url: "/api/owner/max/status", headers: { cookie: studentCookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/owner/max/check", headers: { cookie: ownerCookie, "x-csrf-token": csrf(ownerCookie) } })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: "/api/webhooks/max", payload: { update_type: "bot_started" } })).statusCode).toBe(503);
  });
});
