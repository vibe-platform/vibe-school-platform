import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../apps/api/src/app.js";
import { prisma } from "../apps/api/src/db.js";
function cookie(value: string | string[] | undefined) { return (Array.isArray(value) ? value : value ? [value] : []).map((v) => v.split(";", 1)[0]).join("; "); }
function csrf(value: string) { return value.split("; ").find((v) => v.startsWith("vibe_csrf="))?.slice(10) ?? ""; }
describe("teachers choose their own classes", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  it("allows teacher and admin to select several school classes, keeps prior reviews, and denies other schools", async () => {
    const enter = async (profileKey: string) => cookie((await app.inject({ method: "POST", url: "/api/auth/test/session", payload: { profileKey } })).headers["set-cookie"]);
    const teacherCookie = await enter("user-2"), adminCookie = await enter("user-3"), studentCookie = await enter("user-1");
    const teacher = await prisma.user.findUniqueOrThrow({ where: { testProfileKey: "user-2" }, include: { memberships: { where: { active: true, approved: true }, take: 1 } } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { testProfileKey: "user-3" }, include: { memberships: { where: { active: true, approved: true }, take: 1 } } });
    const student = await prisma.user.findUniqueOrThrow({ where: { testProfileKey: "user-1" }, include: { memberships: { where: { active: true, approved: true }, take: 1 } } });
    const t = teacher.memberships[0]!, a = admin.memberships[0]!, studentMember = student.memberships[0]!;
    const originalTeacher = await prisma.teacherClass.findMany({ where: { teacherId: t.id, active: true } });
    const originalAdmin = await prisma.teacherClass.findMany({ where: { teacherId: a.id, active: true } });
    const extra = await prisma.schoolClass.create({ data: { schoolId: t.schoolId, name: "8Б", normalizedName: `8Б-${Date.now()}` } });
    const otherSchool = await prisma.school.create({ data: { name: `Другая ${Date.now()}`, city: "Тест", isSynthetic: true } });
    const foreign = await prisma.schoolClass.create({ data: { schoolId: otherSchool.id, name: "9А", normalizedName: "9А" } });
    let assignmentId = "";
    const save = (c: string, ids: string[]) => app.inject({ method: "PUT", url: "/api/teacher/classes", headers: { cookie: c, "x-csrf-token": csrf(c) }, payload: { classIds: ids } });
    try {
      const options = await app.inject({ method: "GET", url: "/api/teacher/class-options", headers: { cookie: teacherCookie } });
      expect(options.statusCode).toBe(200); expect(options.json().some((row: { id: string }) => row.id === extra.id)).toBe(true);
      expect((await save(studentCookie, [extra.id])).statusCode).toBe(403);
      expect((await save(teacherCookie, [foreign.id])).statusCode).toBe(400);
      expect((await save(teacherCookie, [studentMember.classId!, extra.id])).statusCode).toBe(200);
      expect((await save(adminCookie, [studentMember.classId!, extra.id])).statusCode).toBe(200);
      const users = await app.inject({ method: "GET", url: "/api/admin/users", headers: { cookie: adminCookie } });
      const adminRow = users.json().find((row: { id: string }) => row.id === a.id);
      expect(adminRow.role).toBe("SCHOOL_ADMIN"); expect(adminRow.teacherClassNames).toContain("8Б");
      const created = await app.inject({ method: "POST", url: "/api/teacher/assignments", headers: { cookie: teacherCookie, "x-csrf-token": csrf(teacherCookie) }, payload: { title: "Проверка классов", subject: "Математика", category: "Учёба", description: "Тест", classIds: [studentMember.classId], questions: [{ prompt: "Ответ", type: "LONG_ANSWER", points: 1 }], publish: true } });
      expect(created.statusCode).toBe(201); assignmentId = created.json().id;
      const question = await prisma.question.findFirstOrThrow({ where: { assignmentId } });
      const submission = await prisma.submission.create({ data: { assignmentId, membershipId: studentMember.id, status: "SUBMITTED", submittedAt: new Date(), answers: { create: { questionId: question.id, textValue: "Тест" } } } });
      expect((await save(teacherCookie, [])).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/api/teacher/classes", headers: { cookie: teacherCookie } })).json()).toEqual([]);
      const reviews = await app.inject({ method: "GET", url: "/api/teacher/submissions", headers: { cookie: teacherCookie } });
      expect(reviews.json().some((row: { id: string }) => row.id === submission.id)).toBe(true);
      const review = await app.inject({ method: "POST", url: `/api/teacher/submissions/${submission.id}/review`, headers: { cookie: teacherCookie, "x-csrf-token": csrf(teacherCookie) }, payload: { action: "return", comment: "Доработай" } });
      expect(review.statusCode).toBe(200);
      expect((await save(teacherCookie, [studentMember.classId!])).statusCode).toBe(200);
    } finally {
      if (assignmentId) await prisma.assignment.delete({ where: { id: assignmentId } });
      await prisma.teacherClass.deleteMany({ where: { teacherId: { in: [t.id, a.id] }, classId: extra.id } });
      await prisma.teacherClass.updateMany({ where: { teacherId: { in: [t.id, a.id] } }, data: { active: false } });
      for (const row of [...originalTeacher, ...originalAdmin]) await prisma.teacherClass.update({ where: { id: row.id }, data: { active: true } });
      await prisma.membership.update({ where: { id: a.id }, data: { isTeacher: a.isTeacher } });
      await prisma.schoolClass.delete({ where: { id: extra.id } }); await prisma.school.delete({ where: { id: otherSchool.id } });
    }
  });
});
