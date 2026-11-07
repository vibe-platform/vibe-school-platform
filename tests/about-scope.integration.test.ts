import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { buildApp } from "../apps/api/src/app.js";
import { prisma } from "../apps/api/src/db.js";
import { sha256 } from "../apps/api/src/security.js";

function cookies(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value : value ? [value] : []).map((item) => item.split(";", 1)[0]).filter((item) => item.includes("=")).join("; ");
}
function csrf(cookie: string) { return cookie.split("; ").find((value) => value.startsWith("vibe_csrf="))?.slice("vibe_csrf=".length) ?? ""; }

describe("the project owner edits one shared About page", () => {
  let app: FastifyInstance;
  let ownerCookie = "";
  let testOwnerCookie = "";
  let ownerId = "";
  let originalMain: Prisma.AboutPageGetPayload<{ include: { teamMembers: true; sections: true } }> | null = null;
  const restore = new Map<string, string | undefined>();

  beforeAll(async () => {
    for (const key of ["NODE_ENV", "ENABLE_TEST_LOGIN", "DEMO_MODE"]) restore.set(key, process.env[key]);
    process.env.NODE_ENV = "test";
    process.env.ENABLE_TEST_LOGIN = "true";
    process.env.DEMO_MODE = "false";
    app = await buildApp();
    const owner = await prisma.user.create({ data: { maxUserId: `988${Date.now()}`, firstName: "Владелец", lastName: "Проверка About", platformRole: "PROJECT_OWNER" } });
    ownerId = owner.id;
    const token = randomBytes(32).toString("base64url");
    await prisma.session.create({ data: { userId: owner.id, authSource: "MAX", tokenHash: sha256(token), expiresAt: new Date(Date.now() + 60_000) } });
    ownerCookie = `vibe_session=${token}; vibe_csrf=${randomBytes(24).toString("base64url")}`;
    const testOwner = await app.inject({ method: "POST", url: "/api/auth/test/session", payload: { profileKey: "user-4" } });
    testOwnerCookie = cookies(testOwner.headers["set-cookie"]);
    originalMain = await prisma.aboutPage.findUnique({ where: { id: "main" }, include: { teamMembers: true, sections: true } });
  });

  afterAll(async () => {
    if (app) await app.close();
    if (originalMain) await prisma.$transaction(async (tx) => {
      await tx.aboutTeamMember.deleteMany({ where: { pageId: "main" } });
      await tx.aboutSection.deleteMany({ where: { pageId: "main" } });
      await tx.aboutPage.update({ where: { id: "main" }, data: { title: originalMain!.title, description: originalMain!.description, updatedById: originalMain!.updatedById } });
      if (originalMain!.teamMembers.length) await tx.aboutTeamMember.createMany({ data: originalMain!.teamMembers.map(({ id, pageId, name, role, description, imageAttachmentId, sortOrder, isVisible }) => ({ id, pageId, name, role, description, imageAttachmentId, sortOrder, isVisible })) });
      if (originalMain!.sections.length) await tx.aboutSection.createMany({ data: originalMain!.sections.map(({ id, pageId, title, body, imageAttachmentId, sortOrder, isVisible }) => ({ id, pageId, title, body, imageAttachmentId, sortOrder, isVisible })) });
    });
    if (ownerId) await prisma.user.deleteMany({ where: { id: ownerId } });
    for (const [key, value] of restore) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });

  it("lets the public owner profile and MAX owner session read and change the same page", async () => {
    const publicBefore = await app.inject({ method: "GET", url: "/api/about", headers: { cookie: ownerCookie } });
    expect(publicBefore.statusCode).toBe(200);
    const publicTitle = publicBefore.json().title;

    const testBefore = await app.inject({ method: "GET", url: "/api/about", headers: { cookie: testOwnerCookie } });
    expect(testBefore.statusCode).toBe(200);
    expect(testBefore.json()).toMatchObject({ id: "main", title: publicTitle });

    const sharedTitle = `Обновление владельца ${Date.now()}`;
    const save = await app.inject({ method: "PUT", url: "/api/owner/about", headers: { cookie: testOwnerCookie, "x-csrf-token": csrf(testOwnerCookie) }, payload: { title: sharedTitle, description: "Общие сведения для всех посетителей.", teamMembers: [], sections: [] } });
    expect(save.statusCode).toBe(200);
    expect(save.json()).toMatchObject({ id: "main", title: sharedTitle });

    const publicAfter = await app.inject({ method: "GET", url: "/api/about", headers: { cookie: ownerCookie } });
    expect(publicAfter.json().title).toBe(sharedTitle);
    expect((await prisma.aboutPage.findUniqueOrThrow({ where: { id: "main" } })).title).toBe(sharedTitle);
  });
});
