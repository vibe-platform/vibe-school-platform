import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../apps/api/src/app.js";
import { prisma } from "../apps/api/src/db.js";
import { autoSubmitExpired } from "../apps/api/src/task-routes.js";
import { dispatchBotOutboxBatch } from "../apps/api/src/bot.js";
function cookies(value: string | string[] | undefined) { return (Array.isArray(value) ? value : value ? [value] : []).map((v) => v.split(";", 1)[0]).join("; "); }
function csrf(value: string) { return value.split("; ").find((v) => v.startsWith("vibe_csrf="))?.slice(10) ?? ""; }
describe("teachers remove their own assignments", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  it("withdraws the task without deleting work or granting new rewards", async () => {
    const enter = async (profileKey: string) => cookies((await app.inject({ method: "POST", url: "/api/auth/test/session", payload: { profileKey } })).headers["set-cookie"]);
    const teacherCookie = await enter("user-2"), adminCookie = await enter("user-3"), studentCookie = await enter("user-1");
    const student = await prisma.user.findUniqueOrThrow({ where: { testProfileKey: "user-1" }, include: { memberships: { where: { active: true, approved: true }, take: 1 } } });
    const member = student.memberships[0]!;
    const response = await app.inject({ method: "POST", url: "/api/teacher/assignments", headers: { cookie: teacherCookie, "x-csrf-token": csrf(teacherCookie) }, payload: { title: "Удаляемая работа", subject: "Математика", category: "Учёба", description: "Тест", classIds: [member.classId], questions: [{ prompt: "Сколько?", type: "NUMBER", points: 1, acceptedAnswers: ["2"] }], publish: true } });
    expect(response.statusCode).toBe(201); const id = response.json().id as string;
    try {
      const question = await prisma.question.findFirstOrThrow({ where: { assignmentId: id } });
      await prisma.assignment.update({ where: { id }, data: { dueAt: new Date(Date.now() - 60_000) } });
      const submission = await prisma.submission.create({ data: { assignmentId: id, membershipId: member.id, status: "IN_PROGRESS", startedAt: new Date(Date.now() - 120_000), answers: { create: { questionId: question.id, textValue: "2" } } } });
      const submitted = await prisma.submission.create({ data: { assignmentId: id, membershipId: member.id, attempt: 2, status: "SUBMITTED", submittedAt: new Date(), answers: { create: { questionId: question.id, textValue: "2" } } } });
      const pending = await prisma.outbox.create({ data: { dedupeKey: `notification:task:assigned:${id}:isolated`, transport: "mock", recipient: student.id, body: "{}", status: "PENDING" } });
      const url = `/api/teacher/assignments/${id}`;
      expect((await app.inject({ method: "DELETE", url })).statusCode).toBe(403);
      expect((await app.inject({ method: "DELETE", url, headers: { cookie: studentCookie, "x-csrf-token": csrf(studentCookie) } })).statusCode).toBe(403);
      expect((await app.inject({ method: "DELETE", url, headers: { cookie: adminCookie, "x-csrf-token": csrf(adminCookie) } })).statusCode).toBe(404);
      expect((await app.inject({ method: "DELETE", url, headers: { cookie: teacherCookie } })).statusCode).toBe(403);
      expect((await app.inject({ method: "DELETE", url, headers: { cookie: teacherCookie, "x-csrf-token": csrf(teacherCookie) } })).statusCode).toBe(200);
      expect((await prisma.assignment.findUniqueOrThrow({ where: { id } })).archived).toBe(true);
      expect((await prisma.outbox.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("SKIPPED");
      expect((await app.inject({ method: "GET", url: `/api/tasks/${id}`, headers: { cookie: studentCookie } })).statusCode).toBe(404);
      const own = await app.inject({ method: "GET", url: "/api/teacher/assignments", headers: { cookie: teacherCookie } });
      expect(own.json().some((row: { id: string }) => row.id === id)).toBe(false);
      expect((await app.inject({ method: "DELETE", url, headers: { cookie: teacherCookie, "x-csrf-token": csrf(teacherCookie) } })).statusCode).toBe(404);
      await autoSubmitExpired();
      expect((await prisma.submission.findUniqueOrThrow({ where: { id: submission.id } })).status).toBe("IN_PROGRESS");
      expect((await prisma.submission.findUniqueOrThrow({ where: { id: submitted.id } })).status).toBe("SUBMITTED");
      const reviews = await app.inject({ method: "GET", url: "/api/teacher/submissions", headers: { cookie: teacherCookie } });
      expect(reviews.json().some((item: { id: string }) => item.id === submitted.id)).toBe(true);
      expect((await prisma.membership.findUniqueOrThrow({ where: { id: member.id } })).balance).toBe(member.balance);
      const late = await prisma.outbox.create({ data: { dedupeKey: `notification:task:reminder:${id}:late`, transport: "mock", recipient: student.id, body: "{}", status: "PENDING" } });
      await dispatchBotOutboxBatch(); expect((await prisma.outbox.findUniqueOrThrow({ where: { id: late.id } })).status).toBe("SKIPPED");
    } finally {
      await prisma.notification.deleteMany({ where: { OR: [{ eventKey: { startsWith: `task:assigned:${id}:` } }, { eventKey: { startsWith: `task:reminder:${id}:` } }] } });
      await prisma.outbox.deleteMany({ where: { OR: [{ dedupeKey: { startsWith: `notification:task:assigned:${id}:` } }, { dedupeKey: { startsWith: `notification:task:reminder:${id}:` } }] } });
      await prisma.assignment.delete({ where: { id } });
    }
  });
});
