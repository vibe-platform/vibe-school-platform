import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { buildApp } from "../apps/api/src/app.js";
import { prisma } from "../apps/api/src/db.js";
import { sha256 } from "../apps/api/src/security.js";

function cookies(value: string | string[] | undefined) { return (Array.isArray(value) ? value : value ? [value] : []).map((item) => item.split(";", 1)[0]).filter((item) => item.includes("=")).join("; "); }
function csrf(cookie: string) { return cookie.split("; ").find((value) => value.startsWith("vibe_csrf="))?.slice("vibe_csrf=".length) ?? ""; }
function multipart(fields: Record<string, string>, fileName: string, mime: string, bytes: Buffer) {
  const boundary = `vibe-${randomBytes(8).toString("hex")}`;
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${mime}\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { boundary, payload: Buffer.concat(chunks) };
}

describe("public documents and moderated anonymous reviews", () => {
  let app: FastifyInstance;
  let realOwnerCookie = "";
  let testOwnerCookie = "";
  let testStudentCookie = "";
  let ownerId = "";
  let documentId = "";
  let testDocumentId = "";
  let reviewId = "";
  const prefix = `Материал проверки ${Date.now()}`;
  const reviewBody = `Проверочный отзыв о сервисе ${Date.now()}, всё понятно.`;
  const restore = new Map<string, string | undefined>();

  beforeAll(async () => {
    for (const key of ["NODE_ENV", "ENABLE_TEST_LOGIN", "DEMO_MODE", "MAX_BOT_ENABLED", "MAX_BOT_TOKEN", "MAX_BOT_USERNAME", "MAX_BOT_URL", "MAX_MINI_APP_URL"]) restore.set(key, process.env[key]);
    process.env.NODE_ENV = "test"; process.env.ENABLE_TEST_LOGIN = "true"; process.env.DEMO_MODE = "false"; process.env.MAX_BOT_ENABLED = "false"; delete process.env.MAX_BOT_TOKEN;
    app = await buildApp();
    const owner = await prisma.user.create({ data: { maxUserId: `987${Date.now()}`, firstName: "Владелец", lastName: "Библиотека", platformRole: "PROJECT_OWNER" } });
    ownerId = owner.id;
    const token = randomBytes(32).toString("base64url");
    await prisma.session.create({ data: { userId: owner.id, authSource: "MAX", tokenHash: sha256(token), expiresAt: new Date(Date.now() + 60_000) } });
    realOwnerCookie = `vibe_session=${token}; vibe_csrf=${randomBytes(24).toString("base64url")}`;
    const testOwner = await app.inject({ method: "POST", url: "/api/auth/test/session", payload: { profileKey: "user-4" } });
    testOwnerCookie = cookies(testOwner.headers["set-cookie"]);
    const student = await app.inject({ method: "POST", url: "/api/auth/test/session", payload: { profileKey: "user-1" } });
    testStudentCookie = cookies(student.headers["set-cookie"]);
  });

  afterAll(async () => {
    if (documentId) await app.inject({ method: "DELETE", url: `/api/owner/documents/${documentId}`, headers: { cookie: realOwnerCookie, "x-csrf-token": csrf(realOwnerCookie) } });
    if (testDocumentId) await app.inject({ method: "DELETE", url: `/api/owner/documents/${testDocumentId}`, headers: { cookie: testOwnerCookie, "x-csrf-token": csrf(testOwnerCookie) } });
    if (reviewId) await prisma.publicReview.deleteMany({ where: { id: reviewId } });
    if (app) await app.close();
    if (ownerId) await prisma.user.deleteMany({ where: { id: ownerId } });
    for (const [key, value] of restore) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await prisma.$disconnect();
  });

  it("keeps drafts private and gives every owner session access to the same published documents", async () => {
    const denied = await app.inject({ method: "GET", url: "/api/owner/documents" });
    expect(denied.statusCode).toBe(401);
    const pdf = Buffer.from("%PDF-1.7\nSample PDF for integration test\n%%EOF", "ascii");
    const draftForm = multipart({ title: `${prefix} черновик`, category: "Проверка", description: "Не виден посетителям.", status: "DRAFT" }, "notice.pdf", "application/pdf", pdf);
    const draftCreate = await app.inject({ method: "POST", url: "/api/owner/documents", headers: { cookie: realOwnerCookie, "x-csrf-token": csrf(realOwnerCookie), "content-type": `multipart/form-data; boundary=${draftForm.boundary}` }, payload: draftForm.payload });
    expect(draftCreate.statusCode).toBe(201);
    documentId = draftCreate.json().id;
    expect((await app.inject({ method: "GET", url: `/api/documents/${documentId}/file` })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/documents?q=${encodeURIComponent(prefix)}` })).json().items).toHaveLength(0);
    const publish = await app.inject({ method: "PATCH", url: `/api/owner/documents/${documentId}`, headers: { cookie: realOwnerCookie, "x-csrf-token": csrf(realOwnerCookie) }, payload: { status: "PUBLISHED" } });
    expect(publish.statusCode).toBe(200);
    const listing = await app.inject({ method: "GET", url: `/api/documents?q=${encodeURIComponent(prefix)}` });
    expect(listing.json().items).toHaveLength(1);
    const read = await app.inject({ method: "GET", url: listing.json().items[0].fileUrl });
    expect(read.statusCode).toBe(200);
    expect(read.headers["content-type"]).toContain("application/pdf");
    expect(read.headers["content-disposition"]).toContain("inline");
    const badForm = multipart({ title: `${prefix} invalid`, category: "Проверка", status: "PUBLISHED" }, "fake.pdf", "application/pdf", Buffer.from("not a pdf"));
    const invalid = await app.inject({ method: "POST", url: "/api/owner/documents", headers: { cookie: realOwnerCookie, "x-csrf-token": csrf(realOwnerCookie), "content-type": `multipart/form-data; boundary=${badForm.boundary}` }, payload: badForm.payload });
    expect(invalid.statusCode).toBe(415);

    const testForm = multipart({ title: `${prefix} владелец`, category: "Проверка", status: "PUBLISHED" }, "notice.pdf", "application/pdf", pdf);
    const testCreate = await app.inject({ method: "POST", url: "/api/owner/documents", headers: { cookie: testOwnerCookie, "x-csrf-token": csrf(testOwnerCookie), "content-type": `multipart/form-data; boundary=${testForm.boundary}` }, payload: testForm.payload });
    expect(testCreate.statusCode).toBe(201);
    testDocumentId = testCreate.json().id;
    const sharedListing = await app.inject({ method: "GET", url: `/api/documents?q=${encodeURIComponent(prefix)}`, headers: { cookie: testOwnerCookie } });
    expect(sharedListing.json().items.map((item: { title: string }) => item.title)).toContain(`${prefix} владелец`);
    expect(sharedListing.json().items.map((item: { title: string }) => item.title)).toContain(`${prefix} черновик`);
    expect((await app.inject({ method: "GET", url: "/api/owner/documents", headers: { cookie: realOwnerCookie } })).json().map((item: { id: string }) => item.id)).toContain(testDocumentId);
    expect(listing.json().items.map((item: { title: string }) => item.title)).toEqual([`${prefix} черновик`]);
  });

  it("publishes only approved reviews without returning author identity", async () => {
    const denied = await app.inject({ method: "POST", url: "/api/reviews", payload: { rating: 5, body: reviewBody } });
    expect(denied.statusCode).toBe(403);
    const ownerDenied = await app.inject({ method: "POST", url: "/api/reviews", headers: { cookie: realOwnerCookie, "x-csrf-token": csrf(realOwnerCookie) }, payload: { rating: 5, body: reviewBody } });
    expect(ownerDenied.statusCode).toBe(403);
    const testOwnerDenied = await app.inject({ method: "POST", url: "/api/reviews", headers: { cookie: testOwnerCookie, "x-csrf-token": csrf(testOwnerCookie) }, payload: { rating: 5, body: reviewBody } });
    expect(testOwnerDenied.statusCode).toBe(403);
    const submitted = await app.inject({ method: "POST", url: "/api/reviews", headers: { cookie: testStudentCookie, "x-csrf-token": csrf(testStudentCookie) }, payload: { rating: 5, body: reviewBody } });
    expect(submitted.statusCode).toBe(201);
    const row = await prisma.publicReview.findFirstOrThrow({ where: { body: reviewBody, isSynthetic: true } });
    reviewId = row.id;
    expect(row.status).toBe("PENDING");
    const hidden = await app.inject({ method: "GET", url: "/api/reviews", headers: { cookie: testOwnerCookie } });
    expect(hidden.json().items.some((review: { id: string }) => review.id === reviewId)).toBe(false);
    const approved = await app.inject({ method: "PATCH", url: `/api/owner/reviews/${reviewId}`, headers: { cookie: testOwnerCookie, "x-csrf-token": csrf(testOwnerCookie) }, payload: { status: "APPROVED" } });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).not.toHaveProperty("authorId");
    const testPublic = await app.inject({ method: "GET", url: "/api/reviews", headers: { cookie: testOwnerCookie } });
    const publicReview = testPublic.json().items.find((review: { id: string }) => review.id === reviewId);
    expect(publicReview).toMatchObject({ id: reviewId, rating: 5, body: reviewBody, status: "APPROVED" });
    expect(publicReview).not.toHaveProperty("authorId");
    const publicView = await app.inject({ method: "GET", url: "/api/reviews" });
    expect(publicView.json().items.some((review: { id: string }) => review.id === reviewId)).toBe(true);
    const rateLimited = await app.inject({ method: "POST", url: "/api/reviews", headers: { cookie: testStudentCookie, "x-csrf-token": csrf(testStudentCookie) }, payload: { rating: 4, body: `${reviewBody} второй раз` } });
    expect(rateLimited.statusCode).toBe(429);
  });
});
