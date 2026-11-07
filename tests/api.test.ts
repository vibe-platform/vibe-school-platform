import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../apps/api/src/app.js";
import { prisma } from "../apps/api/src/db.js";
import { notifyEvent } from "../apps/api/src/notifications.js";
import { dispatchBotOutboxBatch } from "../apps/api/src/bot.js";
import { sha256 } from "../apps/api/src/security.js";

describe("local backend session and privacy controls", () => {
  let app: FastifyInstance;
  let cookie = "";
  let studentId = "";

  beforeAll(async () => {
    app = await buildApp();
    const student = await prisma.user.findUniqueOrThrow({ where: { testProfileKey: "user-1" }, include: { memberships: { where: { active: true, approved: true }, take: 1 } } });
    const teacher = await prisma.user.findUniqueOrThrow({ where: { testProfileKey: "user-2" }, include: { memberships: { where: { active: true, approved: true }, take: 1 } } });
    studentId = student.id;
    const membership = student.memberships[0]!;
    const teacherMembership = teacher.memberships[0]!;
    await prisma.assignment.upsert({
      where: { seedKey: "unit-test-assignment" },
      create: {
        seedKey: "unit-test-assignment", schoolId: membership.schoolId, teacherId: teacher.id,
        title: "Тестовая работа API", subject: "Математика", category: "Учёба", description: "Фикстура только для изолированного integration теста", published: true,
        questions: { create: { prompt: "Сколько будет 1 + 1?", type: "NUMBER", points: 1, acceptedJson: JSON.stringify(["2"]) } },
        targets: { create: { classId: membership.classId!, recipients: { connect: { id: membership.id } } } },
      },
      update: { published: true },
    });
    expect(teacherMembership.role).toBe("TEACHER");
  });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it("authenticates a seeded student, serves their profile/tasks, and rejects role/CSRF violations", async () => {
    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ ok: true, service: "vibe-api", database: "connected" });

    const listed = await app.inject({ method: "GET", url: "/api/auth/test/profiles" });
    expect(listed.statusCode).toBe(200);
    expect((listed.json() as Array<{ name: string; role: string }>).map((user) => [user.name, user.role])).toEqual([
      ["Пользователь 1", "STUDENT"],
      ["Пользователь 2", "TEACHER"],
      ["Пользователь 3", "SCHOOL_ADMIN"],
      ["Пользователь 4", "PROJECT_OWNER"],
    ]);

    const arbitraryLogin = await app.inject({ method: "POST", url: "/api/auth/test/session", payload: { profileKey: "not-a-profile" } });
    expect(arbitraryLogin.statusCode).toBe(400);
    const login = await app.inject({ method: "POST", url: "/api/auth/test/session", payload: { profileKey: "user-1" } });
    expect(login.statusCode).toBe(200);
    const setCookie = login.headers["set-cookie"];
    cookie = (Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []).map((item) => item.split(";", 1)[0]).join("; ");
    expect(cookie).toContain("vibe_session=");

    const session = await app.inject({ method: "GET", url: "/api/session/me", headers: { cookie } });
    expect(session.json()).toMatchObject({ authenticated: true, user: { role: "STUDENT", isTeacher: false } });
    const profile = await app.inject({ method: "GET", url: "/api/profile", headers: { cookie } });
    expect(profile.statusCode).toBe(200);
    expect(profile.json().cosmetics).toBeUndefined();
    const customize = await app.inject({ method: "GET", url: "/api/profile/customize", headers: { cookie } });
    const appearance = customize.json().appearance as Record<string, unknown>;
    expect(Object.keys(appearance).sort()).toEqual(["background", "emoji", "frame", "pattern", "title"]);
    const tasks = await app.inject({ method: "GET", url: "/api/tasks", headers: { cookie } });
    expect(tasks.statusCode).toBe(200);
    expect(tasks.json().tasks.length).toBeGreaterThan(0);
    const forbidden = await app.inject({ method: "GET", url: "/api/owner/overview", headers: { cookie } });
    expect(forbidden.statusCode).toBe(403);
    const csrf = await app.inject({ method: "PUT", url: "/api/profile/preferences", headers: { cookie }, payload: { reduceMotion: true } });
    expect(csrf.statusCode).toBe(403);

    const csrfCookie = cookie.split("; ").find((part) => part.startsWith("vibe_csrf="))?.split("=", 2)[1];
    const testUser = await prisma.user.findUniqueOrThrow({ where: { id: studentId }, select: { maxUserId: true } });
    const recipients = [testUser.maxUserId, studentId].filter((value): value is string => Boolean(value));
    const oldMessages = await prisma.botMessage.findMany({ where: { userId: studentId }, select: { id: true } });
    const oldOutbox = await prisma.outbox.findMany({ where: { transport: "mock", recipient: { in: recipients } }, select: { id: true } });
    const botReply = await app.inject({ method: "POST", url: "/api/bot/mock-command", headers: { cookie, "x-csrf-token": csrfCookie! }, payload: { command: "/balance" } });
    expect(botReply.statusCode).toBe(200);
    expect(botReply.json().text).toContain("Ваш баланс");
    const mockLog = await app.inject({ method: "GET", url: "/api/bot/mock-log", headers: { cookie } });
    expect(mockLog.statusCode).toBe(200);
    expect(mockLog.json().messages.some((message: { text: string }) => message.text === "/balance")).toBe(true);
    const newMessages = await prisma.botMessage.findMany({ where: { userId: studentId }, select: { id: true } });
    const newOutbox = await prisma.outbox.findMany({ where: { transport: "mock", recipient: { in: recipients } }, select: { id: true } });
    await prisma.botMessage.deleteMany({ where: { id: { in: newMessages.filter((message) => !oldMessages.some((old) => old.id === message.id)).map((message) => message.id) } } });
    await prisma.outbox.deleteMany({ where: { id: { in: newOutbox.filter((row) => !oldOutbox.some((old) => old.id === row.id)).map((row) => row.id) } } });

    const notificationKey = `test:${studentId}:${Date.now()}`;
    await notifyEvent({ userId: studentId, eventKey: notificationKey, kind: "TASKS", title: "Проверка inbox", body: "Личное уведомление" });
    const inbox = await app.inject({ method: "GET", url: "/api/notifications", headers: { cookie } });
    expect(inbox.statusCode).toBe(200);
    expect(inbox.json().items[0]).toMatchObject({ eventKey: notificationKey, title: "Проверка inbox", readAt: null });
    const marked = await app.inject({ method: "POST", url: `/api/notifications/${inbox.json().items[0].id}/read`, headers: { cookie, "x-csrf-token": csrfCookie! } });
    expect(marked.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/notifications", headers: { cookie } })).json().unread).toBe(0);
    await prisma.notification.deleteMany({ where: { eventKey: notificationKey } });
    await prisma.outbox.deleteMany({ where: { dedupeKey: `notification:${notificationKey}` } });

    const outboxKey = `test:outbox:${Date.now()}`;
    await prisma.outbox.create({ data: { dedupeKey: outboxKey, transport: "mock", recipient: studentId, body: JSON.stringify({ text: "Очередь доставлена" }), nextAttemptAt: new Date() } });
    await dispatchBotOutboxBatch();
    expect((await prisma.outbox.findUniqueOrThrow({ where: { dedupeKey: outboxKey } })).status).toBe("SENT");
    await prisma.outbox.delete({ where: { dedupeKey: outboxKey } });

    const previousProductionTestLogin = process.env.ENABLE_TEST_LOGIN;
    const previousProductionDemoMode = process.env.DEMO_MODE;
    process.env.ENABLE_TEST_LOGIN = "false";
    process.env.DEMO_MODE = "false";
    try {
      expect((await app.inject({ method: "GET", url: "/api/auth/test/profiles" })).statusCode).toBe(404);
      expect((await app.inject({ method: "POST", url: "/api/auth/test/session", payload: { profileKey: "user-1" } })).statusCode).toBe(404);
      expect((await app.inject({ method: "GET", url: "/api/session/me", headers: { cookie } })).json().authenticated).toBe(false);
    } finally {
      if (previousProductionTestLogin === undefined) delete process.env.ENABLE_TEST_LOGIN;
      else process.env.ENABLE_TEST_LOGIN = previousProductionTestLogin;
      if (previousProductionDemoMode === undefined) delete process.env.DEMO_MODE;
      else process.env.DEMO_MODE = previousProductionDemoMode;
    }
    const previousNodeEnv = process.env.NODE_ENV;
    const previousTestLogin = process.env.ENABLE_TEST_LOGIN;
    const previousDemoMode = process.env.DEMO_MODE;
    process.env.NODE_ENV = "production";
    try {
      process.env.ENABLE_TEST_LOGIN = "true";
      process.env.DEMO_MODE = "false";
      expect((await app.inject({ method: "GET", url: "/api/auth/test/profiles" })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/api/session/me", headers: { cookie } })).json().authenticated).toBe(true);
      process.env.ENABLE_TEST_LOGIN = "false";
      expect((await app.inject({ method: "GET", url: "/api/auth/test/profiles" })).statusCode).toBe(404);
      expect((await app.inject({ method: "GET", url: "/api/session/me", headers: { cookie } })).json().authenticated).toBe(false);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousTestLogin === undefined) delete process.env.ENABLE_TEST_LOGIN;
      else process.env.ENABLE_TEST_LOGIN = previousTestLogin;
      if (previousDemoMode === undefined) delete process.env.DEMO_MODE;
      else process.env.DEMO_MODE = previousDemoMode;
    }
    expect((await app.inject({ method: "GET", url: "/api/session/me", headers: { cookie } })).json().authenticated).toBe(true);

    const previousCookie = cookie;
    const logout = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie: previousCookie } });
    expect(logout.statusCode).toBe(200);
    cookie = "";
    expect((await app.inject({ method: "GET", url: "/api/session/me", headers: { cookie: previousCookie } })).json().authenticated).toBe(false);
  });

  it("grants test teacher and school-admin profiles the normal endpoints for their roles", async () => {
    const enter = async (profileKey: "user-2" | "user-3") => {
      const response = await app.inject({ method: "POST", url: "/api/auth/test/session", payload: { profileKey } });
      expect(response.statusCode).toBe(200);
      const header = response.headers["set-cookie"];
      const cookie = (Array.isArray(header) ? header : header ? [header] : []).map((item) => item.split(";", 1)[0]).join("; ");
      const csrfToken = cookie.split("; ").find((part) => part.startsWith("vibe_csrf="))?.split("=", 2)[1];
      return { cookie, csrfToken };
    };
    const teacher = await enter("user-2");
    const teacherClasses = await app.inject({ method: "GET", url: "/api/teacher/classes", headers: { cookie: teacher.cookie } });
    expect(teacherClasses.statusCode).toBe(200);
    expect(teacherClasses.json().length).toBeGreaterThan(0);
    expect((await app.inject({ method: "GET", url: "/api/teacher/assignments", headers: { cookie: teacher.cookie } })).statusCode).toBe(200);
    const createdAssignment = await app.inject({
      method: "POST", url: "/api/teacher/assignments", headers: { cookie: teacher.cookie, "x-csrf-token": teacher.csrfToken! },
      payload: { title: "Задание из тестового профиля", subject: "Математика", category: "Учёба", description: "Проверка полномочий учителя.", classIds: [teacherClasses.json()[0].id], questions: [{ prompt: "Сколько будет 1 + 1?", type: "NUMBER", points: 1, acceptedAnswers: ["2"] }], publish: false },
    });
    expect(createdAssignment.statusCode).toBe(201);
    const question = await prisma.question.findFirstOrThrow({ where: { assignmentId: createdAssignment.json().id } });
    const student = await prisma.user.findUniqueOrThrow({ where: { testProfileKey: "user-1" }, include: { memberships: { where: { active: true, approved: true }, take: 1 } } });
    const studentMembership = student.memberships[0]!;
    const eventKey = `notification:task:assigned:${createdAssignment.json().id}:${student.id}`;
    expect(await prisma.outbox.count({ where: { dedupeKey: eventKey } })).toBe(0);
    const publish = () => app.inject({ method: "POST", url: `/api/teacher/assignments/${createdAssignment.json().id}/publish`, headers: { cookie: teacher.cookie, "x-csrf-token": teacher.csrfToken! } });
    expect((await publish()).statusCode).toBe(200);
    expect((await publish()).statusCode).toBe(200);
    const assigned = await prisma.outbox.findMany({ where: { dedupeKey: eventKey } });
    expect(assigned).toHaveLength(1);
    expect(assigned[0]!.recipient).toBe(student.id);
    expect(JSON.parse(assigned[0]!.body).buttons[0].type).toBe("open_app");
    const submission = await prisma.submission.create({ data: { assignmentId: createdAssignment.json().id, membershipId: studentMembership.id, status: "SUBMITTED", submittedAt: new Date(), answers: { create: { questionId: question.id, textValue: "2" } } } });
    const graded = await app.inject({ method: "POST", url: `/api/teacher/submissions/${submission.id}/review`, headers: { cookie: teacher.cookie, "x-csrf-token": teacher.csrfToken! }, payload: { action: "complete", scores: { [question.id]: 1 } } });
    expect(graded.statusCode).toBe(200);
    expect(graded.json()).toMatchObject({ grade: 5, earnedPoints: 1, maxPoints: 1 });
    const checked = await prisma.outbox.findMany({ where: { dedupeKey: `notification:task:checked:${submission.id}` } });
    expect(checked).toHaveLength(1);
    expect(checked[0]!.recipient).toBe(student.id);
    expect(JSON.parse(checked[0]!.body).text).toContain("Оценка: 5");
    expect(JSON.parse(checked[0]!.body).buttons[0].type).toBe("open_app");
    expect((await app.inject({ method: "POST", url: `/api/teacher/submissions/${submission.id}/review`, headers: { cookie: teacher.cookie, "x-csrf-token": teacher.csrfToken! }, payload: { action: "complete", scores: { [question.id]: 1 } } })).statusCode).not.toBe(200);
    expect(await prisma.outbox.count({ where: { dedupeKey: `notification:task:checked:${submission.id}` } })).toBe(1);

    const admin = await enter("user-3");
    expect((await app.inject({ method: "GET", url: "/api/admin/overview", headers: { cookie: admin.cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/admin/users", headers: { cookie: admin.cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/admin/classes", headers: { cookie: admin.cookie } })).statusCode).toBe(200);
    const createdClass = await app.inject({ method: "POST", url: "/api/admin/classes", headers: { cookie: admin.cookie, "x-csrf-token": admin.csrfToken! }, payload: { name: `Проверка ${Date.now()}` } });
    expect(createdClass.statusCode).toBe(201);
  });

  it("records current legal versions server-side, keeps consent separate, and scopes it to the signed-in user", async () => {
    const previousConsentRequired = process.env.LEGAL_PD_CONSENT_REQUIRED;
    process.env.LEGAL_PD_CONSENT_REQUIRED = "false";
    const maxUserId = `990${Date.now()}`;
    const otherMaxUserId = `991${Date.now()}`;
    let regularUserId = "";
    let otherUserId = "";
    try {
      const regular = await prisma.user.create({ data: { maxUserId, firstName: "Правовой", lastName: "Профиль" } });
      regularUserId = regular.id;
      const other = await prisma.user.create({ data: { maxUserId: otherMaxUserId, firstName: "Другой", lastName: "Профиль" } });
      otherUserId = other.id;
      const token = randomBytes(32).toString("base64url");
      const csrfToken = randomBytes(24).toString("base64url");
      const cookie = `vibe_session=${token}; vibe_csrf=${csrfToken}`;
      await prisma.session.create({ data: { userId: regular.id, authSource: "MAX", tokenHash: sha256(token), expiresAt: new Date(Date.now() + 60_000) } });

      const before = await app.inject({ method: "GET", url: "/api/legal/acceptance", headers: { cookie } });
      expect(before.statusCode).toBe(200);
      expect(before.json().required.map((document: { type: string }) => document.type)).toEqual(["TERMS"]);
      expect((await app.inject({ method: "POST", url: "/api/legal/acceptance", headers: { cookie }, payload: { termsAccepted: true } })).statusCode).toBe(403);
      const forged = await app.inject({ method: "POST", url: "/api/legal/acceptance", headers: { cookie, "x-csrf-token": csrfToken }, payload: { termsAccepted: true, userId: other.id, acceptedAt: "2001-01-01" } });
      expect(forged.statusCode).toBe(400);

      const payload = { termsAccepted: true };
      const first = await app.inject({ method: "POST", url: "/api/legal/acceptance", headers: { cookie, "x-csrf-token": csrfToken }, payload });
      expect(first.statusCode).toBe(200);
      const saved = await prisma.legalAcceptance.findFirstOrThrow({ where: { userId: regular.id, documentType: "TERMS" } });
      expect(saved).toMatchObject({ source: "MAX", consentStatus: "ACKNOWLEDGED" });
      expect(saved.acceptedAt.getTime()).toBeGreaterThan(Date.parse("2026-01-01"));
      const repeated = await app.inject({ method: "POST", url: "/api/legal/acceptance", headers: { cookie, "x-csrf-token": csrfToken }, payload });
      expect(repeated.statusCode).toBe(200);
      expect(await prisma.legalAcceptance.count({ where: { userId: regular.id, documentType: "TERMS" } })).toBe(1);
      expect((await prisma.legalAcceptance.findUniqueOrThrow({ where: { id: saved.id } })).acceptedAt).toEqual(saved.acceptedAt);
      expect(await prisma.legalAcceptance.count({ where: { userId: other.id } })).toBe(0);

      process.env.LEGAL_PD_CONSENT_REQUIRED = "true";
      const consentRequired = await app.inject({ method: "GET", url: "/api/legal/acceptance", headers: { cookie } });
      expect(consentRequired.json().required.map((document: { type: string }) => document.type)).toEqual(["PERSONAL_DATA_CONSENT"]);
      expect((await app.inject({ method: "POST", url: "/api/legal/acceptance", headers: { cookie, "x-csrf-token": csrfToken }, payload: { termsAccepted: true } })).statusCode).toBe(400);
      const granted = await app.inject({ method: "POST", url: "/api/legal/acceptance", headers: { cookie, "x-csrf-token": csrfToken }, payload: { termsAccepted: true, personalDataConsent: true } });
      expect(granted.statusCode).toBe(200);
      const consent = await prisma.legalAcceptance.findFirstOrThrow({ where: { userId: regular.id, documentType: "PERSONAL_DATA_CONSENT" } });
      expect(consent).toMatchObject({ source: "MAX", consentStatus: "GRANTED" });
      expect((await app.inject({ method: "POST", url: "/api/legal/personal-data-consent/revoke", headers: { cookie, "x-csrf-token": csrfToken } })).statusCode).toBe(200);
      expect(await prisma.legalAcceptance.findUniqueOrThrow({ where: { id: consent.id } })).toMatchObject({ consentStatus: "REVOKED", revokedAt: expect.any(Date) });
      expect((await app.inject({ method: "POST", url: "/api/legal/personal-data-consent/revoke", headers: { cookie, "x-csrf-token": csrfToken } })).statusCode).toBe(409);
      expect((await app.inject({ method: "GET", url: "/api/legal/acceptance", headers: { cookie } })).json().required.map((document: { type: string }) => document.type)).toEqual(["PERSONAL_DATA_CONSENT"]);
      expect(await prisma.legalAcceptance.count({ where: { userId: other.id } })).toBe(0);
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: [regularUserId, otherUserId].filter(Boolean) } } });
      if (previousConsentRequired === undefined) delete process.env.LEGAL_PD_CONSENT_REQUIRED;
      else process.env.LEGAL_PD_CONSENT_REQUIRED = previousConsentRequired;
    }
  });

  it("allows the DEMO_MODE alias only outside production", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousDemoMode = process.env.DEMO_MODE;
    const previousTestLogin = process.env.ENABLE_TEST_LOGIN;
    try {
      process.env.NODE_ENV = "test";
      process.env.DEMO_MODE = "true";
      process.env.ENABLE_TEST_LOGIN = "false";
      expect((await app.inject({ method: "GET", url: "/api/auth/test/profiles" })).statusCode).toBe(200);
      process.env.NODE_ENV = "production";
      expect((await app.inject({ method: "GET", url: "/api/auth/test/profiles" })).statusCode).toBe(404);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousDemoMode === undefined) delete process.env.DEMO_MODE;
      else process.env.DEMO_MODE = previousDemoMode;
      if (previousTestLogin === undefined) delete process.env.ENABLE_TEST_LOGIN;
      else process.env.ENABLE_TEST_LOGIN = previousTestLogin;
    }
  });
});
