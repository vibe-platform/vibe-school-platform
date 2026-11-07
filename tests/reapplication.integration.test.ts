import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../apps/api/src/app.js";
import { prisma } from "../apps/api/src/db.js";

function cookies(value: string | string[] | undefined) { return (Array.isArray(value) ? value : value ? [value] : []).map((v) => v.split(";", 1)[0]).join("; "); }
function csrf(cookie: string) { return cookie.split("; ").find((v) => v.startsWith("vibe_csrf="))?.slice(10) ?? ""; }

describe("returning to the same school", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  it("shows the join action after removal and accepts a new class without losing membership data", async () => {
    const studentLogin = await app.inject({ method: "POST", url: "/api/auth/test/session", payload: { profileKey: "user-1" } });
    const adminLogin = await app.inject({ method: "POST", url: "/api/auth/test/session", payload: { profileKey: "user-3" } });
    const studentCookie = cookies(studentLogin.headers["set-cookie"]), adminCookie = cookies(adminLogin.headers["set-cookie"]);
    const student = await prisma.user.findUniqueOrThrow({ where: { testProfileKey: "user-1" }, include: { memberships: { where: { active: true, approved: true }, take: 1 } } });
    const member = student.memberships[0]!;
    const extraClass = await prisma.schoolClass.create({ data: { schoolId: member.schoolId, name: "Тест 9Б", normalizedName: `ТЕСТ-${Date.now()}` } });
    try {
      await prisma.membership.update({ where: { id: member.id }, data: { balance: 77, totalExp: 12 } });
      const remove = await app.inject({ method: "POST", url: `/api/admin/memberships/${member.id}/leave`, headers: { cookie: adminCookie, "x-csrf-token": csrf(adminCookie) } });
      expect(remove.statusCode).toBe(200);
      const tasks = await app.inject({ method: "GET", url: "/api/tasks", headers: { cookie: studentCookie } });
      expect(tasks.json().nextAction).toMatchObject({ title: "Присоединитесь к школе", href: "/onboarding" });
      const send = (classId: string) => app.inject({ method: "POST", url: "/api/onboarding/request", headers: { cookie: studentCookie, "x-csrf-token": csrf(studentCookie) }, payload: { schoolId: member.schoolId, classId, firstName: "Тест", lastName: "Ученик" } });
      const request = await send(extraClass.id); expect(request.statusCode).toBe(201); expect(request.json().membershipId).toBe(member.id);
      let row = await prisma.membership.findUniqueOrThrow({ where: { id: member.id } });
      expect(row).toMatchObject({ active: true, approved: false, classId: extraClass.id, balance: 77, totalExp: 12 });
      expect((await send(member.classId!)).statusCode).toBe(201);
      row = await prisma.membership.findUniqueOrThrow({ where: { id: member.id } }); expect(row.classId).toBe(member.classId);
      expect(await prisma.membership.count({ where: { userId: student.id, schoolId: member.schoolId } })).toBe(1);
      const teacher = await prisma.user.findUniqueOrThrow({ where: { testProfileKey: "user-2" } });
      const oldTask = await prisma.assignment.create({ data: { schoolId: member.schoolId, teacherId: teacher.id, title: "Ранее опубликованная работа", subject: "Тест", category: "Учёба", description: "Тест", published: true, targets: { create: { classId: member.classId! } } }, include: { targets: true } });
      const draft = await prisma.assignment.create({ data: { schoolId: member.schoolId, teacherId: teacher.id, title: "Черновик", subject: "Тест", category: "Учёба", description: "Тест", published: false, targets: { create: { classId: member.classId! } } }, include: { targets: true } });
      expect((await app.inject({ method: "POST", url: `/api/admin/join-requests/${member.id}/approve`, headers: { cookie: adminCookie, "x-csrf-token": csrf(adminCookie) } })).statusCode).toBe(200);
      const target = await prisma.assignmentTarget.findUniqueOrThrow({ where: { id: oldTask.targets[0]!.id }, include: { recipients: true } });
      expect(target.recipients.some((recipient) => recipient.id === member.id)).toBe(true);
      const draftTarget = await prisma.assignmentTarget.findUniqueOrThrow({ where: { id: draft.targets[0]!.id }, include: { recipients: true } });
      expect(draftTarget.recipients.some((recipient) => recipient.id === member.id)).toBe(false);
      await prisma.assignment.deleteMany({ where: { id: { in: [oldTask.id, draft.id] } } });
      row = await prisma.membership.findUniqueOrThrow({ where: { id: member.id } }); expect(row).toMatchObject({ active: true, approved: true, balance: 77, totalExp: 12 });
      const adminUser = await prisma.user.findUniqueOrThrow({ where: { testProfileKey: "user-3" } });
      await prisma.membership.update({ where: { id: member.id }, data: { active: false, blockedReason: "Старое состояние" } });
      await prisma.auditLog.create({ data: { actorId: adminUser.id, schoolId: member.schoolId, action: "MEMBERSHIP_BLOCKED", objectType: "Membership", objectId: member.id } });
      const users = await app.inject({ method: "GET", url: "/api/admin/users", headers: { cookie: adminCookie } });
      expect(users.json().find((item: { id: string }) => item.id === member.id)).toMatchObject({ active: false, accountBlocked: false });
      expect((await send(extraClass.id)).statusCode).toBe(201);
      expect(await prisma.membership.findUniqueOrThrow({ where: { id: member.id } })).toMatchObject({ active: true, approved: false, classId: extraClass.id, balance: 77, totalExp: 12 });
      expect((await app.inject({ method: "POST", url: `/api/admin/memberships/${member.id}/block`, headers: { cookie: adminCookie, "x-csrf-token": csrf(adminCookie) }, payload: { reason: "Тест" } })).statusCode).toBe(404);
    } finally {
      await prisma.membership.update({ where: { id: member.id }, data: { active: member.active, approved: member.approved, classId: member.classId, balance: member.balance, totalExp: member.totalExp, blockedReason: member.blockedReason } });
      await prisma.schoolClass.delete({ where: { id: extraClass.id } });
    }
  });
});
