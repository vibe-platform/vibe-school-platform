import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../apps/api/src/app.js";
import { prisma } from "../apps/api/src/db.js";

function cookies(value: string | string[] | undefined) { return (Array.isArray(value) ? value : value ? [value] : []).map((v) => v.split(";", 1)[0]).join("; "); }
function csrf(cookie: string) { return cookie.split("; ").find((v) => v.startsWith("vibe_csrf="))?.slice(10) ?? ""; }

describe("school administrator who teaches", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  it("selects own school classes and teaches while keeping admin permissions", async () => {
    const adminLogin = await app.inject({ method: "POST", url: "/api/auth/test/session", payload: { profileKey: "user-3" } });
    const studentLogin = await app.inject({ method: "POST", url: "/api/auth/test/session", payload: { profileKey: "user-1" } });
    const adminCookie = cookies(adminLogin.headers["set-cookie"]), studentCookie = cookies(studentLogin.headers["set-cookie"]);
    const session = await app.inject({ method: "GET", url: "/api/session/me", headers: { cookie: adminCookie } });
    expect(session.json().user).toMatchObject({ role: "SCHOOL_ADMIN", isSchoolAdmin: true, isTeacher: true });
    const admin = await prisma.user.findUniqueOrThrow({ where: { testProfileKey: "user-3" }, include: { memberships: { where: { active: true, approved: true }, take: 1 } } });
    const student = await prisma.user.findUniqueOrThrow({ where: { testProfileKey: "user-1" }, include: { memberships: { where: { active: true, approved: true }, take: 1 } } });
    const member = admin.memberships[0]!, studentMember = student.memberships[0]!;
    const before = await prisma.teacherClass.findMany({ where: { teacherId: member.id, active: true } });
    let assignmentId = "";
    try {
      const choose = await app.inject({ method: "PUT", url: `/api/admin/memberships/${member.id}/teacher-classes`, headers: { cookie: adminCookie, "x-csrf-token": csrf(adminCookie) }, payload: { classIds: [studentMember.classId] } });
      expect(choose.statusCode).toBe(200);
      const mine = await app.inject({ method: "GET", url: "/api/teacher/classes", headers: { cookie: adminCookie } });
      expect(mine.json().some((row: { id: string }) => row.id === studentMember.classId)).toBe(true);
      const schoolClasses = await app.inject({ method: "GET", url: "/api/admin/classes", headers: { cookie: adminCookie } });
      expect(schoolClasses.json().find((row: { id: string }) => row.id === studentMember.classId).teachers.some((row: { membershipId: string }) => row.membershipId === member.id)).toBe(true);
      expect((await app.inject({ method: "GET", url: "/api/admin/overview", headers: { cookie: adminCookie } })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/api/teacher/stats", headers: { cookie: adminCookie } })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/api/teacher/classes", headers: { cookie: studentCookie } })).statusCode).toBe(403);
      expect((await app.inject({ method: "PUT", url: `/api/admin/memberships/${member.id}/teacher-classes`, headers: { cookie: adminCookie, "x-csrf-token": csrf(adminCookie) }, payload: { classIds: ["outside-school"] } })).statusCode).toBe(400);
      const created = await app.inject({ method: "POST", url: "/api/teacher/assignments", headers: { cookie: adminCookie, "x-csrf-token": csrf(adminCookie) }, payload: { title: "Проверочная работа администратора", subject: "Математика", category: "Учёба", description: "Тест", classIds: [studentMember.classId], questions: [{ prompt: "1+1?", type: "NUMBER", points: 1, acceptedAnswers: ["2"] }], publish: true } });
      expect(created.statusCode).toBe(201); assignmentId = created.json().id;
      const preview = await app.inject({ method: "GET", url: `/api/tasks/${assignmentId}`, headers: { cookie: adminCookie } });
      expect(preview.statusCode).toBe(200); expect(preview.json().previewOnly).toBe(true);
      const tasks = await app.inject({ method: "GET", url: "/api/tasks", headers: { cookie: studentCookie } });
      expect(tasks.json().tasks.some((row: { id: string }) => row.id === assignmentId)).toBe(true);
      expect(await prisma.membership.findUniqueOrThrow({ where: { id: member.id } })).toMatchObject({ role: "SCHOOL_ADMIN", isTeacher: true });
      expect((await app.inject({ method: "POST", url: "/api/auth/test/session", payload: { profileKey: "user-3" } })).statusCode).toBe(200);
    } finally {
      if (assignmentId) await prisma.assignment.delete({ where: { id: assignmentId } });
      await prisma.membership.update({ where: { id: member.id }, data: { isTeacher: member.isTeacher } });
      await prisma.teacherClass.deleteMany({ where: { teacherId: member.id, classId: { notIn: before.map((row) => row.classId) } } });
      for (const row of before) await prisma.teacherClass.update({ where: { id: row.id }, data: { active: true } });
    }
  });
  it("lets the owner promote an existing teacher without losing teaching access", async () => {
    const ownerLogin = await app.inject({ method: "POST", url: "/api/auth/test/session", payload: { profileKey: "user-4" } });
    const ownerCookie = cookies(ownerLogin.headers["set-cookie"]);
    const school = await prisma.school.findFirstOrThrow({ where: { isSynthetic: true }, include: { classes: { where: { archivedAt: null }, take: 1 } } });
    const user = await prisma.user.create({ data: { firstName: "Тест", lastName: "Учитель-администратор" } });
    const member = await prisma.membership.create({ data: { userId: user.id, schoolId: school.id, role: "TEACHER", isTeacher: true, active: true, approved: true } });
    await prisma.teacherClass.create({ data: { teacherId: member.id, classId: school.classes[0]!.id, active: true } });
    try {
      const candidates = await app.inject({ method: "GET", url: `/api/owner/users?scope=candidates&schoolId=${school.id}`, headers: { cookie: ownerCookie } });
      expect(candidates.json().some((row: { id: string }) => row.id === user.id)).toBe(true);
      const promote = await app.inject({ method: "POST", url: `/api/owner/schools/${school.id}/admin`, headers: { cookie: ownerCookie, "x-csrf-token": csrf(ownerCookie) }, payload: { userId: user.id, enabled: true } });
      expect(promote.statusCode).toBe(200);
      expect(await prisma.membership.findUniqueOrThrow({ where: { id: member.id } })).toMatchObject({ role: "SCHOOL_ADMIN", isSchoolAdmin: true, isTeacher: true });
      expect(await prisma.teacherClass.count({ where: { teacherId: member.id, active: true } })).toBe(1);
      const remove = await app.inject({ method: "POST", url: `/api/owner/schools/${school.id}/admin`, headers: { cookie: ownerCookie, "x-csrf-token": csrf(ownerCookie) }, payload: { userId: user.id, enabled: false } });
      expect(remove.statusCode).toBe(200);
      expect(await prisma.membership.findUniqueOrThrow({ where: { id: member.id } })).toMatchObject({ role: "TEACHER", isSchoolAdmin: false, isTeacher: true });
    } finally { await prisma.teacherClass.deleteMany({ where: { teacherId: member.id } }); await prisma.membership.delete({ where: { id: member.id } }); await prisma.user.delete({ where: { id: user.id } }); }
  });
});
