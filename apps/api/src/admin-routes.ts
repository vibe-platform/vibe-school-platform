import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "./db.js";
import { requireAuth, requireRole } from "./security.js";
import { displayUserName } from "./display-name.js";

const timezoneIsValid = (value: string) => { try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; } catch { return false; } };
const normalizeClassName = (value: string) => value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleUpperCase("ru-RU");
const compareClassNames = (left: string, right: string) => left.localeCompare(right, "ru", { numeric: true, sensitivity: "base" });
const schoolVisibility = (isTest: boolean | null) => isTest === null ? {} : { isSynthetic: isTest };
// Enrollment lists every active school regardless of whether it is marked as
// a test/demo school. Only active classes are offered, and the request endpoint
// requires an active class from the selected, non-archived school.
const enrollmentSchoolWhere: Prisma.SchoolWhereInput = {
  archivedAt: null,
};
const pendingSubmissionStatuses = ["IN_PROGRESS", "SUBMITTED", "RETURNED"] as const;
const queryVariants = (value: string) => {
  const lower = value.toLocaleLowerCase("ru-RU");
  const title = lower.slice(0, 1).toLocaleUpperCase("ru-RU") + lower.slice(1);
  const variants = new Set([value, lower, title, value.toLocaleUpperCase("ru-RU")]);
  for (const item of [...variants]) { variants.add(item.replace(/ё/giu, "е")); variants.add(item.replace(/е/giu, "ё")); }
  return [...variants];
};

async function audit(actorId: string, schoolId: string | null, action: string, objectType: string, objectId: string, changes: unknown, reason?: string) {
  await prisma.auditLog.create({ data: { actorId, schoolId, action, objectType, objectId, changesJson: JSON.stringify(changes ?? {}), reason } });
}

async function ownerSchoolRows(isTest: boolean | null, query = "", status: "active" | "archived" = "active") {
  const rows = await prisma.school.findMany({
    where: { ...schoolVisibility(isTest), archivedAt: status === "active" ? null : { not: null }, ...(query ? { OR: [{ name: { contains: query } }, { city: { contains: query } }] } : {}) },
    orderBy: [{ city: "asc" }, { name: "asc" }, { id: "asc" }],
    include: {
      _count: { select: { classes: true, memberships: true, assignments: true, products: true } },
      classes: { where: { archivedAt: null }, select: { id: true } },
      memberships: { where: { active: true, approved: true, role: "SCHOOL_ADMIN", isSchoolAdmin: true }, include: { user: { select: { id: true, displayName: true, firstName: true, lastName: true, testProfileKey: true } } } },
    },
  });
  return Promise.all(rows.map(async (school) => ({
    id: school.id, name: school.name, city: school.city, timezone: school.timezone, archivedAt: school.archivedAt,
    activeClasses: school.classes.length, classes: school._count.classes, users: school._count.memberships,
    students: await prisma.membership.count({ where: { schoolId: school.id, role: "STUDENT", active: true, approved: true } }),
    assignments: school._count.assignments, products: school._count.products,
    administrators: school.memberships.map((row) => ({ membershipId: row.id, userId: row.userId, name: displayUserName(row.user), manageable: isTest === null || (isTest ? Boolean(row.user.testProfileKey && !["user-1", "user-2", "user-3", "user-4"].includes(row.user.testProfileKey)) : row.user.testProfileKey === null) })),
  })));
}

export async function registerAdminRoutes(app: FastifyInstance) {
  app.get("/api/onboarding/options", async (request, reply) => {
    const context = await requireAuth(request, reply);
    if (!context) return;
    const [schools, pending] = await Promise.all([
      prisma.school.findMany({ where: enrollmentSchoolWhere, orderBy: [{ city: "asc" }, { name: "asc" }, { id: "asc" }], include: { classes: { where: { archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } } } }),
      prisma.membership.findFirst({ where: { userId: context.user.id, active: true, approved: false, school: enrollmentSchoolWhere }, include: { school: true } }),
    ]);
    return { schools: schools.map(({ id, name, city, classes }) => ({ id, name, city, classes })), pending: pending ? { school: pending.school.name, schoolId: pending.schoolId, classId: pending.classId } : null };
  });

  app.post("/api/onboarding/request", async (request, reply) => {
    const context = await requireAuth(request, reply);
    if (!context) return;
    const parsed = z.object({ schoolId: z.string(), classId: z.string(), firstName: z.string().trim().min(1).max(80), lastName: z.string().trim().min(1).max(80), middleName: z.string().trim().max(80).optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Укажите имя, фамилию, школу и класс" });
    const schoolClass = await prisma.schoolClass.findFirst({ where: { id: parsed.data.classId, schoolId: parsed.data.schoolId, archivedAt: null, school: enrollmentSchoolWhere }, include: { school: true } });
    if (!schoolClass) return reply.code(400).send({ error: "Выберите класс из указанной школы" });
    if (context.user.platformRole) return reply.code(403).send({ error: "Глобальный аккаунт владельца не может подавать заявку как ученик" });
    const active = await prisma.membership.findFirst({ where: { userId: context.user.id, active: true, approved: true } });
    if (active) return reply.code(409).send({ error: "У аккаунта уже есть подтверждённая школьная принадлежность" });
    const previous = await prisma.membership.findUnique({ where: { userId_schoolId: { userId: context.user.id, schoolId: schoolClass.schoolId } } });
    if (previous && (previous.role !== "STUDENT" || previous.isTeacher || previous.isSchoolAdmin)) return reply.code(409).send({ error: "Для повторного присоединения обратитесь к администрации школы" });
    const membership = await prisma.$transaction(async (tx) => {
      let id: string;
      if (previous) {
        const updated = await tx.membership.updateMany({ where: { id: previous.id, OR: [{ active: false }, { active: true, approved: false }] }, data: { classId: schoolClass.id, active: true, approved: false, blockedReason: null } });
        if (!updated.count) return null;
        id = previous.id;
      } else {
        const created = await tx.membership.create({ data: { userId: context.user.id, schoolId: schoolClass.schoolId, classId: schoolClass.id, role: "STUDENT", active: true, approved: false } });
        id = created.id;
      }
      await tx.user.update({ where: { id: context.user.id }, data: { firstName: parsed.data.firstName, lastName: parsed.data.lastName, middleName: parsed.data.middleName ?? null } });
      return { id };
    }).catch((error: unknown) => { if (error instanceof Error && "code" in error && error.code === "P2002") return null; throw error; });
    if (!membership) return reply.code(409).send({ error: "Состояние заявки изменилось. Обновите страницу и попробуйте снова." });
    return reply.code(201).send({ ok: true, status: "Ожидает подтверждения", membershipId: membership.id, school: schoolClass.school.name });
  });

  app.get("/api/admin/overview", async (request, reply) => {
    const context = await requireRole(request, reply, ["SCHOOL_ADMIN"]);
    if (!context) return;
    if (!context.membership) return reply.code(403).send({ error: "Нет школы в активной сессии" });
    const days = (request.query as { days?: string }).days ?? "30";
    const periodDays = days === "all" ? null : days === "7" ? 7 : 30;
    const since = periodDays === null ? null : new Date(Date.now() - periodDays * 86_400_000);
    const schoolId = context.membership.schoolId;
    const submissionPeriod = since ? { submittedAt: { gte: since } } : {};
    const assignmentPeriod = since ? { createdAt: { gte: since } } : {};
    const [students, assignments, submissions, activeRows, pending, auditRows] = await Promise.all([
      prisma.membership.count({ where: { schoolId, role: "STUDENT", active: true, approved: true } }),
      prisma.assignment.count({ where: { schoolId, ...assignmentPeriod } }),
      prisma.submission.findMany({ where: { assignment: { schoolId }, ...submissionPeriod }, select: { membershipId: true, status: true, grade: true, submittedAt: true } }),
      prisma.submission.findMany({ where: { assignment: { schoolId }, status: "COMPLETED", ...submissionPeriod, membership: { role: "STUDENT", active: true, approved: true } }, distinct: ["membershipId"], select: { membershipId: true } }),
      prisma.submission.count({ where: { assignment: { schoolId }, status: "SUBMITTED" } }),
      prisma.auditLog.findMany({ where: { schoolId }, orderBy: { createdAt: "desc" }, take: 10, include: { actor: { select: { displayName: true, firstName: true, lastName: true } } } }),
    ]);
    const gradeDistribution = { 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const row of submissions) if (row.status === "COMPLETED" && row.grade) gradeDistribution[row.grade as 2 | 3 | 4 | 5] += 1;
    const completed = submissions.filter((row) => row.status === "COMPLETED").length;
    return {
      periodDays, school: { id: schoolId, name: (await prisma.school.findUnique({ where: { id: schoolId }, select: { name: true } }))?.name },
      activeStudents: { active: activeRows.length, total: students, percent: students ? Math.round(activeRows.length / students * 100) : null },
      assignments, submissions: submissions.length, pending,
      gradeDistribution, completion: { done: completed, total: submissions.length },
      audit: auditRows.map((row) => ({ id: row.id, action: row.action, objectType: row.objectType, objectId: row.objectId, reason: row.reason, createdAt: row.createdAt, actor: row.actor ? displayUserName(row.actor) : "Система" })),
    };
  });

  app.get("/api/admin/users", async (request, reply) => {
    const context = await requireRole(request, reply, ["SCHOOL_ADMIN"]);
    if (!context) return;
    if (!context.membership) return [];
    const query = (request.query as { q?: string }).q?.trim() ?? "";
    const where = { schoolId: context.membership.schoolId, approved: true, ...(query ? { user: { OR: [{ displayName: { contains: query } }, { firstName: { contains: query } }, { lastName: { contains: query } }, { username: { contains: query } }] } } : {}) };
    const rows = await prisma.membership.findMany({ where, include: { user: { select: { id: true, displayName: true, firstName: true, lastName: true, username: true, isBlocked: true } }, schoolClass: { select: { id: true, name: true } }, teacherClasses: { where: { active: true, schoolClass: { archivedAt: null } }, select: { classId: true, schoolClass: { select: { name: true } } } } }, orderBy: [{ user: { displayName: "asc" } }, { user: { lastName: "asc" } }, { user: { firstName: "asc" } }] });
    return rows.map((row) => ({ id: row.id, userId: row.user.id, name: displayUserName(row.user), username: row.user.username, class: row.schoolClass?.name ?? "—", role: row.role, isTeacher: row.isTeacher || row.role === "TEACHER" || row.isSchoolAdmin || row.role === "SCHOOL_ADMIN", teacherClassIds: row.teacherClasses.map((item) => item.classId), teacherClassNames: row.teacherClasses.map((item) => item.schoolClass.name).sort(compareClassNames), isSchoolAdmin: row.isSchoolAdmin || row.role === "SCHOOL_ADMIN", active: row.active, accountBlocked: row.user.isBlocked, blocked: row.user.isBlocked || !row.active, blockedReason: row.blockedReason }));
  });

  app.get("/api/admin/classes", async (request, reply) => {
    const context = await requireRole(request, reply, ["SCHOOL_ADMIN"]);
    if (!context) return;
    if (!context.membership) return [];
    const params = request.query as { q?: string; status?: string };
    const query = params.q?.trim() ?? "";
    const status = params.status === "archived" ? { not: null } : null;
    const classes = await prisma.schoolClass.findMany({
      where: { schoolId: context.membership.schoolId, archivedAt: status, ...(query ? { name: { contains: query } } : {}) },
      include: {
        memberships: { where: { active: true, approved: true }, include: { user: { select: { id: true, displayName: true, firstName: true, lastName: true, username: true } } } },
        teacherClasses: { where: { active: true, teacher: { active: true, approved: true, OR: [{ role: "TEACHER" }, { isTeacher: true }, { role: "SCHOOL_ADMIN" }, { isSchoolAdmin: true }] } }, include: { teacher: { include: { user: { select: { id: true, displayName: true, firstName: true, lastName: true } } } } } },
        assignments: { include: { assignment: { select: { id: true, archived: true, submissions: { where: { status: { in: [...pendingSubmissionStatuses] } }, select: { id: true } } } } } },
        _count: { select: { memberships: true, assignments: true, teacherClasses: true } },
      },
    });
    return classes.map((row) => ({
      id: row.id,
      name: row.name,
      archivedAt: row.archivedAt,
      membershipCount: row._count.memberships,
      activeMemberCount: row.memberships.length,
      studentCount: row.memberships.filter((membership) => membership.role === "STUDENT").length,
      inactiveMembershipCount: Math.max(0, row._count.memberships - row.memberships.length),
      teacherCount: row.teacherClasses.length,
      teacherLinkCount: row._count.teacherClasses,
      assignmentCount: row._count.assignments,
      pendingWorkCount: row.assignments.reduce((sum, target) => sum + target.assignment.submissions.length, 0),
      teachers: row.teacherClasses.map(({ teacher }) => ({ membershipId: teacher.id, userId: teacher.userId, name: displayUserName(teacher.user) })),
      students: row.memberships.filter((membership) => membership.role === "STUDENT").map(({ id, user }) => ({ membershipId: id, userId: user.id, name: displayUserName(user) })),
    })).sort((left, right) => compareClassNames(left.name, right.name));
  });

  app.get("/api/admin/products", async (request, reply) => {
    const context = await requireRole(request, reply, ["SCHOOL_ADMIN"]);
    if (!context) return;
    if (!context.membership) return [];
    const products = await prisma.product.findMany({
      where: { scope: "SCHOOL", schoolId: context.membership.schoolId },
      include: { image: { select: { id: true } }, _count: { select: { orders: true } } },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    });
    return products.map(({ image, _count, ...product }) => ({ ...product, imageUrl: image ? `/api/market/products/${product.id}/image` : null, orderCount: _count.orders }));
  });

  app.post("/api/admin/products", async (request, reply) => {
    const context = await requireRole(request, reply, ["SCHOOL_ADMIN"]);
    if (!context) return;
    if (!context.membership) return reply.code(403).send({ error: "Нет школы в активной сессии" });
    const parsed = z.object({ name: z.string().trim().min(2).max(120), description: z.string().trim().min(1).max(2000), category: z.string().trim().min(1).max(80), imageKey: z.string().regex(/^[a-z0-9-]+$/u), price: z.number().int().min(1).max(100_000), stock: z.number().int().min(0).max(100_000), perUserLimit: z.number().int().min(1).max(100).default(1) }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Проверьте поля школьного товара" });
    const slug = `school-${randomBytes(16).toString("hex")}`;
    const product = await prisma.$transaction(async (tx) => {
      const row = await tx.product.create({ data: { ...parsed.data, slug, scope: "SCHOOL", schoolId: context.membership!.schoolId } });
      await tx.auditLog.create({ data: { actorId: context.user.id, schoolId: context.membership!.schoolId, action: "SCHOOL_PRODUCT_CREATED", objectType: "Product", objectId: row.id, changesJson: JSON.stringify({ name: row.name, price: row.price, stock: row.stock }) } });
      return row;
    });
    return reply.code(201).send({ ...product, imageUrl: null, orderCount: 0 });
  });

  app.patch<{ Params: { id: string } }>("/api/admin/products/:id", async (request, reply) => {
    const context = await requireRole(request, reply, ["SCHOOL_ADMIN"]);
    if (!context) return;
    if (!context.membership) return reply.code(403).send({ error: "Нет школы в активной сессии" });
    const parsed = z.object({ name: z.string().trim().min(2).max(120).optional(), description: z.string().trim().min(1).max(2000).optional(), category: z.string().trim().min(1).max(80).optional(), imageKey: z.string().regex(/^[a-z0-9-]+$/u).optional(), price: z.number().int().min(1).max(100_000).optional(), stock: z.number().int().min(0).max(100_000).optional(), perUserLimit: z.number().int().min(1).max(100).optional(), active: z.boolean().optional() }).strict().safeParse(request.body);
    if (!parsed.success || !Object.keys(parsed.data).length) return reply.code(400).send({ error: "Проверьте поля школьного товара" });
    const product = await prisma.product.findFirst({ where: { id: request.params.id, scope: "SCHOOL", schoolId: context.membership.schoolId } });
    if (!product) return reply.code(404).send({ error: "Товар не найден в вашей школе" });
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.product.update({ where: { id: product.id }, data: parsed.data });
      await tx.auditLog.create({ data: { actorId: context.user.id, schoolId: product.schoolId, action: parsed.data.active === false ? "SCHOOL_PRODUCT_ARCHIVED" : "SCHOOL_PRODUCT_UPDATED", objectType: "Product", objectId: product.id, changesJson: JSON.stringify({ before: { name: product.name, active: product.active }, after: parsed.data }) } });
      return row;
    });
    return { ...updated, imageUrl: (await prisma.productImage.findUnique({ where: { productId: updated.id }, select: { id: true } })) ? `/api/market/products/${updated.id}/image` : null };
  });

  app.get("/api/admin/join-requests", async (request, reply) => {
    const context = await requireRole(request, reply, ["SCHOOL_ADMIN"]);
    if (!context) return;
    if (!context.membership) return [];
    const rows = await prisma.membership.findMany({ where: { schoolId: context.membership.schoolId, active: true, approved: false }, include: { user: { select: { id: true, displayName: true, firstName: true, lastName: true, username: true } }, schoolClass: { select: { name: true } } }, orderBy: [{ user: { lastName: "asc" } }, { createdAt: "asc" }] });
    return rows.map((row) => ({ id: row.id, user: { ...row.user, name: displayUserName(row.user) }, className: row.schoolClass?.name ?? "—", createdAt: row.createdAt }));
  });

  app.post<{ Params: { id: string } }>("/api/admin/join-requests/:id/approve", async (request, reply) => {
    const context = await requireRole(request, reply, ["SCHOOL_ADMIN"]);
    if (!context) return;
    if (!context.membership) return reply.code(403).send({ error: "Нет школы в сессии" });
    const pending = await prisma.membership.findFirst({ where: { id: request.params.id, schoolId: context.membership.schoolId, active: true, approved: false } });
    if (!pending) return reply.code(404).send({ error: "Заявка не найдена в вашей школе" });
    await prisma.$transaction(async (tx) => {
      await tx.membership.updateMany({ where: { userId: pending.userId, active: true, approved: true, id: { not: pending.id } }, data: { active: false } });
      await tx.membership.update({ where: { id: pending.id }, data: { approved: true, active: true } });
      if (pending.classId && pending.role === "STUDENT") {
        const targets = await tx.assignmentTarget.findMany({ where: { classId: pending.classId, assignment: { schoolId: pending.schoolId, published: true, archived: false } }, select: { id: true } });
        for (const target of targets) await tx.assignmentTarget.update({ where: { id: target.id }, data: { recipients: { connect: { id: pending.id } } } });
      }
      await tx.auditLog.create({ data: { actorId: context.user.id, schoolId: pending.schoolId, action: "MEMBERSHIP_APPROVED", objectType: "Membership", objectId: pending.id } });
    });
    return { ok: true, status: "APPROVED" };
  });

  app.post<{ Params: { id: string } }>("/api/admin/join-requests/:id/reject", async (request, reply) => {
    const context = await requireRole(request, reply, ["SCHOOL_ADMIN"]);
    if (!context) return;
    if (!context.membership) return reply.code(403).send({ error: "Нет школы в сессии" });
    const row = await prisma.membership.findFirst({ where: { id: request.params.id, schoolId: context.membership.schoolId, active: true, approved: false } });
    if (!row) return reply.code(404).send({ error: "Заявка не найдена" });
    await prisma.membership.update({ where: { id: row.id }, data: { active: false, blockedReason: "Заявка отклонена администрацией школы" } });
    await audit(context.user.id, row.schoolId, "MEMBERSHIP_REJECTED", "Membership", row.id, {}, "Заявка отклонена");
    return { ok: true, status: "REJECTED" };
  });

  app.put<{ Params: { id: string } }>("/api/admin/memberships/:id/teacher", async (request, reply) => {
    const context = await requireRole(request, reply, ["SCHOOL_ADMIN"]);
    if (!context) return;
    if (!context.membership) return reply.code(403).send({ error: "Нет школы в сессии" });
    const parsed = z.object({ enabled: z.boolean(), classIds: z.array(z.string()).max(20).default([]) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Укажите права и закреплённые классы" });
    const target = await prisma.membership.findFirst({ where: { id: request.params.id, schoolId: context.membership.schoolId, active: true, approved: true }, include: { user: true } });
    if (!target) return reply.code(404).send({ error: "Пользователь не найден в вашей школе" });
    if (target.role === "SCHOOL_ADMIN" || target.isSchoolAdmin) return reply.code(409).send({ error: "Сначала снимите права администратора школы отдельным владельческим действием" });
    const validClasses = await prisma.schoolClass.findMany({ where: { id: { in: parsed.data.classIds }, schoolId: context.membership.schoolId, archivedAt: null }, select: { id: true } });
    if (validClasses.length !== parsed.data.classIds.length) return reply.code(400).send({ error: "Класс относится к другой школе, не существует или указан повторно" });
    if (!parsed.data.enabled) {
      const assigned = await prisma.teacherClass.findMany({ where: { teacherId: target.id, active: true }, select: { classId: true } });
      const pending = await prisma.submission.count({ where: { assignment: { teacherId: target.userId, targets: { some: { classId: { in: assigned.map((row) => row.classId) } } } }, status: { in: [...pendingSubmissionStatuses] } } });
      if (pending) return reply.code(409).send({ error: `Нельзя снять роль: у учителя есть ${pending} незавершённых сдач. Сначала завершите или передайте проверки.` });
    }
    const newRole = parsed.data.enabled ? "TEACHER" : "STUDENT";
    await prisma.$transaction(async (tx) => {
      await tx.membership.update({ where: { id: target.id }, data: { isTeacher: parsed.data.enabled, role: newRole } });
      if (parsed.data.enabled) {
        for (const classId of parsed.data.classIds) await tx.teacherClass.upsert({ where: { teacherId_classId: { teacherId: target.id, classId } }, create: { teacherId: target.id, classId, active: true }, update: { active: true } });
      } else {
        await tx.teacherClass.updateMany({ where: { teacherId: target.id }, data: { active: false } });
      }
      await tx.auditLog.create({ data: { actorId: context.user.id, schoolId: target.schoolId, action: parsed.data.enabled ? "TEACHER_ENABLED" : "TEACHER_DISABLED", objectType: "Membership", objectId: target.id, changesJson: JSON.stringify({ role: newRole, addedClassIds: parsed.data.enabled ? parsed.data.classIds : [], removedAllClassAccess: !parsed.data.enabled }) } });
    });
    return { ok: true, isTeacher: parsed.data.enabled, role: newRole };
  });

  app.put<{ Params: { id: string } }>("/api/admin/memberships/:id/teacher-classes", async (request, reply) => {
    const context = await requireRole(request, reply, ["SCHOOL_ADMIN"]);
    if (!context) return;
    if (!context.membership) return reply.code(403).send({ error: "Нет школы в сессии" });
    const parsed = z.object({ classIds: z.array(z.string()).max(100) }).strict().safeParse(request.body);
    if (!parsed.success || new Set(parsed.data.classIds).size !== parsed.data.classIds.length) return reply.code(400).send({ error: "Список классов должен быть корректным и без повторов" });
    const teacher = await prisma.membership.findFirst({ where: { id: request.params.id, schoolId: context.membership.schoolId, active: true, approved: true, OR: [{ role: "TEACHER" }, { isTeacher: true }, { role: "SCHOOL_ADMIN" }, { isSchoolAdmin: true }] } });
    if (!teacher) return reply.code(404).send({ error: "Действующий учитель не найден в вашей школе" });
    const classes = await prisma.schoolClass.findMany({ where: { id: { in: parsed.data.classIds }, schoolId: context.membership.schoolId, archivedAt: null }, select: { id: true } });
    if (classes.length !== parsed.data.classIds.length) return reply.code(400).send({ error: "Выбранный класс относится к другой школе, архивирован или не существует" });
    const current = await prisma.teacherClass.findMany({ where: { teacherId: teacher.id, active: true }, select: { classId: true } });
    const removed = current.map((item) => item.classId).filter((classId) => !parsed.data.classIds.includes(classId));
    await prisma.$transaction(async (tx) => {
      if (parsed.data.classIds.length && (teacher.role === "SCHOOL_ADMIN" || teacher.isSchoolAdmin) && !teacher.isTeacher) await tx.membership.update({ where: { id: teacher.id }, data: { isTeacher: true } });
      await tx.teacherClass.updateMany({ where: { teacherId: teacher.id, classId: { in: removed } }, data: { active: false } });
      for (const classId of parsed.data.classIds) await tx.teacherClass.upsert({ where: { teacherId_classId: { teacherId: teacher.id, classId } }, create: { teacherId: teacher.id, classId, active: true }, update: { active: true } });
      await tx.auditLog.create({ data: { actorId: context.user.id, schoolId: teacher.schoolId, action: "TEACHER_CLASSES_UPDATED", objectType: "Membership", objectId: teacher.id, changesJson: JSON.stringify({ before: current.map((item) => item.classId), after: parsed.data.classIds }) } });
    });
    return { ok: true, classIds: parsed.data.classIds };
  });

  app.post("/api/admin/classes", async (request, reply) => {
    const context = await requireRole(request, reply, ["SCHOOL_ADMIN"]);
    if (!context) return;
    if (!context.membership) return reply.code(403).send({ error: "Нет школы в сессии" });
    const parsed = z.object({ name: z.string().trim().min(1).max(40) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Укажите название класса" });
    const name = parsed.data.name.normalize("NFKC").trim().replace(/\s+/gu, " ");
    const normalizedName = normalizeClassName(name);
    if (await prisma.schoolClass.findFirst({ where: { schoolId: context.membership.schoolId, normalizedName, archivedAt: null } })) return reply.code(409).send({ error: "Активный класс с таким названием уже есть в этой школе" });
    try {
      const schoolClass = await prisma.$transaction(async (tx) => {
        const row = await tx.schoolClass.create({ data: { schoolId: context.membership!.schoolId, name, normalizedName } });
        await tx.auditLog.create({ data: { actorId: context.user.id, schoolId: context.membership!.schoolId, action: "CLASS_CREATED", objectType: "SchoolClass", objectId: row.id, changesJson: JSON.stringify({ name: row.name }) } });
        return row;
      });
      return reply.code(201).send(schoolClass);
    } catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "P2002") return reply.code(409).send({ error: "Активный класс с таким названием уже есть в этой школе" }); throw error; }
  });

  app.patch<{ Params: { id: string } }>("/api/admin/classes/:id", async (request, reply) => {
    const context = await requireRole(request, reply, ["SCHOOL_ADMIN"]);
    if (!context) return;
    if (!context.membership) return reply.code(403).send({ error: "Нет школы в активной сессии" });
    const parsed = z.object({ name: z.string().trim().min(1).max(40) }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Название класса должно быть от 1 до 40 символов" });
    const name = parsed.data.name.normalize("NFKC").trim().replace(/\s+/gu, " ");
    const normalizedName = normalizeClassName(name);
    const before = await prisma.schoolClass.findFirst({ where: { id: request.params.id, schoolId: context.membership.schoolId, archivedAt: null } });
    if (!before) return reply.code(404).send({ error: "Активный класс не найден в вашей школе" });
    try {
      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.schoolClass.update({ where: { id: before.id }, data: { name, normalizedName } });
        await tx.auditLog.create({ data: { actorId: context.user.id, schoolId: before.schoolId, action: "CLASS_RENAMED", objectType: "SchoolClass", objectId: before.id, changesJson: JSON.stringify({ before: before.name, after: name }) } });
        return row;
      });
      return updated;
    } catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "P2002") return reply.code(409).send({ error: "Активный класс с таким названием уже есть в этой школе" }); throw error; }
  });

  app.delete<{ Params: { id: string } }>("/api/admin/classes/:id", async (request, reply) => {
    const context = await requireRole(request, reply, ["SCHOOL_ADMIN"]);
    if (!context) return;
    if (!context.membership) return reply.code(403).send({ error: "Нет школы в активной сессии" });
    const result = await prisma.$transaction(async (tx) => {
      const schoolClass = await tx.schoolClass.findFirst({ where: { id: request.params.id, schoolId: context.membership!.schoolId, archivedAt: null } });
      if (!schoolClass) return { missing: true as const };
      await tx.$executeRaw`UPDATE "SchoolClass" SET "normalizedName" = "normalizedName" WHERE "id" = ${schoolClass.id}`;
      const [memberships, teacherLinks, targets] = await Promise.all([
        tx.membership.count({ where: { classId: schoolClass.id } }),
        tx.teacherClass.count({ where: { classId: schoolClass.id } }),
        tx.assignmentTarget.count({ where: { classId: schoolClass.id } }),
      ]);
      if (memberships || teacherLinks || targets) return { dependencies: { memberships, teacherLinks, targets } };
      await tx.schoolClass.delete({ where: { id: schoolClass.id } });
      await tx.auditLog.create({ data: { actorId: context.user.id, schoolId: schoolClass.schoolId, action: "CLASS_DELETED", objectType: "SchoolClass", objectId: schoolClass.id, changesJson: JSON.stringify({ name: schoolClass.name }) } });
      return { deleted: true as const };
    });
    if ("missing" in result) return reply.code(404).send({ error: "Активный класс не найден" });
    if ("dependencies" in result) return reply.code(409).send({ error: "Класс связан с пользователями, учителями или учебной историей. Переведите учеников и используйте архивирование.", ...result.dependencies });
    return { ok: true, deleted: true };
  });

  app.post<{ Params: { id: string } }>("/api/admin/classes/:id/archive", async (request, reply) => {
    const context = await requireRole(request, reply, ["SCHOOL_ADMIN"]);
    if (!context) return;
    if (!context.membership) return reply.code(403).send({ error: "Нет школы в активной сессии" });
    const result = await prisma.$transaction(async (tx) => {
      const schoolClass = await tx.schoolClass.findFirst({ where: { id: request.params.id, schoolId: context.membership!.schoolId, archivedAt: null } });
      if (!schoolClass) return { missing: true as const };
      await tx.$executeRaw`UPDATE "SchoolClass" SET "normalizedName" = "normalizedName" WHERE "id" = ${schoolClass.id}`;
      const [activeMembers, pendingWork, pendingRequests] = await Promise.all([
        tx.membership.count({ where: { classId: schoolClass.id, active: true, approved: true } }),
        tx.submission.count({ where: { assignment: { targets: { some: { classId: schoolClass.id } } }, status: { in: [...pendingSubmissionStatuses] } } }),
        tx.membership.count({ where: { classId: schoolClass.id, active: true, approved: false } }),
      ]);
      if (activeMembers || pendingWork) return { blocked: true as const, activeMembers, pendingWork };
      await tx.membership.updateMany({ where: { classId: schoolClass.id, active: true, approved: false }, data: { active: false, blockedReason: "Класс архивирован администратором школы" } });
      await tx.teacherClass.updateMany({ where: { classId: schoolClass.id }, data: { active: false } });
      await tx.schoolClass.update({ where: { id: schoolClass.id }, data: { archivedAt: new Date(), normalizedName: `ARCHIVED:${schoolClass.id}` } });
      await tx.auditLog.create({ data: { actorId: context.user.id, schoolId: schoolClass.schoolId, action: "CLASS_ARCHIVED", objectType: "SchoolClass", objectId: schoolClass.id, changesJson: JSON.stringify({ name: schoolClass.name, pendingRequests }) } });
      return { archived: true as const, pendingRequests };
    });
    if ("missing" in result) return reply.code(404).send({ error: "Активный класс не найден" });
    if ("blocked" in result) return reply.code(409).send({ error: "Перед архивированием переведите активных участников и завершите, верните или передайте незакрытые работы.", activeMembers: result.activeMembers, pendingWork: result.pendingWork });
    return result;
  });

  app.post<{ Params: { id: string } }>("/api/admin/classes/:id/restore", async (request, reply) => {
    const context = await requireRole(request, reply, ["SCHOOL_ADMIN"]);
    if (!context) return;
    if (!context.membership) return reply.code(403).send({ error: "Нет школы в активной сессии" });
    const schoolClass = await prisma.schoolClass.findFirst({ where: { id: request.params.id, schoolId: context.membership.schoolId, archivedAt: { not: null } } });
    if (!schoolClass) return reply.code(404).send({ error: "Архивный класс не найден" });
    const normalizedName = normalizeClassName(schoolClass.name);
    try {
      await prisma.$transaction(async (tx) => {
        await tx.schoolClass.update({ where: { id: schoolClass.id }, data: { archivedAt: null, normalizedName } });
        await tx.auditLog.create({ data: { actorId: context.user.id, schoolId: schoolClass.schoolId, action: "CLASS_RESTORED", objectType: "SchoolClass", objectId: schoolClass.id, changesJson: JSON.stringify({ name: schoolClass.name, teacherLinksRestored: false }) } });
      });
      return { ok: true, restored: true, teacherLinksRestored: false };
    } catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "P2002") return reply.code(409).send({ error: "В школе уже есть активный класс с таким названием. Переименуйте его перед восстановлением." }); throw error; }
  });

  app.patch<{ Params: { id: string } }>("/api/admin/memberships/:id/class", async (request, reply) => {
    const context = await requireRole(request, reply, ["SCHOOL_ADMIN"]);
    if (!context) return;
    if (!context.membership) return reply.code(403).send({ error: "Нет школы в активной сессии" });
    const parsed = z.object({ classId: z.string().min(1) }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Выберите действующий целевой класс" });
    const [membership, targetClass] = await Promise.all([
      prisma.membership.findFirst({ where: { id: request.params.id, schoolId: context.membership.schoolId, active: true, approved: true, role: "STUDENT" } }),
      prisma.schoolClass.findFirst({ where: { id: parsed.data.classId, schoolId: context.membership.schoolId, archivedAt: null } }),
    ]);
    if (!membership || !targetClass) return reply.code(404).send({ error: "Ученик или целевой класс не найдены в вашей школе" });
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.membership.update({ where: { id: membership.id }, data: { classId: targetClass.id } });
      await tx.auditLog.create({ data: { actorId: context.user.id, schoolId: membership.schoolId, action: "STUDENT_TRANSFERRED", objectType: "Membership", objectId: membership.id, changesJson: JSON.stringify({ from: membership.classId, to: targetClass.id }) } });
      return row;
    });
    return { ok: true, membershipId: updated.id, classId: updated.classId, historicalRecipientsUnchanged: true };
  });

  app.put<{ Params: { id: string; membershipId: string } }>("/api/admin/classes/:id/teachers/:membershipId", async (request, reply) => {
    const context = await requireRole(request, reply, ["SCHOOL_ADMIN"]);
    if (!context) return;
    if (!context.membership) return reply.code(403).send({ error: "Нет школы в активной сессии" });
    const parsed = z.object({ enabled: z.boolean() }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Укажите, нужно ли назначить учителя этому классу" });
    const [schoolClass, teacher] = await Promise.all([
      prisma.schoolClass.findFirst({ where: { id: request.params.id, schoolId: context.membership.schoolId, archivedAt: null } }),
      prisma.membership.findFirst({ where: { id: request.params.membershipId, schoolId: context.membership.schoolId, active: true, approved: true }, include: { user: { select: { id: true } } } }),
    ]);
    if (!schoolClass || !teacher) return reply.code(404).send({ error: "Учитель или действующий класс не найден в вашей школе" });
    if (teacher.role !== "TEACHER" && !teacher.isTeacher && teacher.role !== "SCHOOL_ADMIN" && !teacher.isSchoolAdmin) return reply.code(409).send({ error: "Сначала назначьте пользователю роль учителя в списке пользователей школы" });
    const result = await prisma.$transaction(async (tx) => {
      if (parsed.data.enabled && (teacher.role === "SCHOOL_ADMIN" || teacher.isSchoolAdmin) && !teacher.isTeacher) await tx.membership.update({ where: { id: teacher.id }, data: { isTeacher: true } });
      const link = await tx.teacherClass.upsert({ where: { teacherId_classId: { teacherId: teacher.id, classId: schoolClass.id } }, create: { teacherId: teacher.id, classId: schoolClass.id, active: parsed.data.enabled }, update: { active: parsed.data.enabled } });
      await tx.auditLog.create({ data: { actorId: context.user.id, schoolId: schoolClass.schoolId, action: parsed.data.enabled ? "TEACHER_ASSIGNED_TO_CLASS" : "TEACHER_REMOVED_FROM_CLASS", objectType: "TeacherClass", objectId: link.id, changesJson: JSON.stringify({ classId: schoolClass.id, teacherMembershipId: teacher.id, roleChanged: false }) } });
      return { active: link.active, teacherRole: teacher.role };
    });
    return { ok: true, ...result };
  });

  app.post<{ Params: { id: string } }>("/api/admin/memberships/:id/leave", async (request, reply) => {
    const context = await requireRole(request, reply, ["SCHOOL_ADMIN"]);
    if (!context) return;
    if (!context.membership) return reply.code(403).send({ error: "Нет школы в активной сессии" });
    const member = await prisma.membership.findFirst({
      where: { id: request.params.id, schoolId: context.membership.schoolId, active: true, approved: true },
      include: { user: { select: { firstName: true, lastName: true, displayName: true } }, school: { select: { name: true } } },
    });
    if (!member) return reply.code(404).send({ error: "Активное членство не найдено" });
    if (member.role !== "STUDENT" || member.isTeacher || member.isSchoolAdmin) return reply.code(409).send({ error: "Эту запись нельзя исключить как ученика. Для ролей сотрудников используйте отдельное управление доступом." });
    await prisma.$transaction(async (tx) => {
      await tx.membership.update({ where: { id: member.id }, data: { active: false, blockedReason: "Исключён из школы администратором" } });
      await tx.auditLog.create({ data: { actorId: context.user.id, schoolId: member.schoolId, action: "STUDENT_REMOVED_FROM_SCHOOL", objectType: "Membership", objectId: member.id, changesJson: JSON.stringify({ userId: member.userId, schoolId: member.schoolId, historyPreserved: true }), reason: "Аккаунт и история школьных работ сохранены" } });
    });
    return { ok: true, membershipId: member.id, schoolName: member.school.name };
  });

  app.get("/api/owner/overview", async (request, reply) => {
    const context = await requireRole(request, reply, ["PROJECT_OWNER"]);
    if (!context) return;
    const isTest = context.user.platformRole === "PROJECT_OWNER" ? null : context.authSource === "TEST";
    const schools = await ownerSchoolRows(isTest);
    const [cosmeticCount, globalProducts, pendingOrders] = await Promise.all([
      prisma.cosmeticItem.count(), prisma.product.count({ where: { scope: "GLOBAL", active: true, ...(isTest === null ? {} : { isSynthetic: isTest }) } }), prisma.order.count({ where: { product: { scope: "GLOBAL", ...(isTest === null ? {} : { isSynthetic: isTest }) }, status: "RESERVED" } }),
    ]);
    return { schools, cosmeticCount, globalProducts, pendingOrders };
  });

  app.get("/api/owner/schools", async (request, reply) => {
    const context = await requireRole(request, reply, ["PROJECT_OWNER"]);
    if (!context) return;
    const params = request.query as { q?: string; status?: string };
    const status = params.status === "archived" ? "archived" : "active";
    return ownerSchoolRows(context.user.platformRole === "PROJECT_OWNER" ? null : context.authSource === "TEST", params.q?.trim() ?? "", status);
  });

  app.get("/api/owner/users", async (request, reply) => {
    const context = await requireRole(request, reply, ["PROJECT_OWNER"]);
    if (!context) return;
    const params = request.query as { schoolId?: string; scope?: string; q?: string; role?: string; status?: string; page?: string; pageSize?: string };
    const isTest = context.user.platformRole === "PROJECT_OWNER" ? null : context.authSource === "TEST";
    const schoolId = params.schoolId?.trim();
    if (params.scope === "candidates") {
      if (!schoolId) return reply.code(400).send({ error: "Выберите школу" });
      const school = await prisma.school.findFirst({ where: { id: schoolId, ...schoolVisibility(isTest), archivedAt: null }, select: { id: true } });
      if (!school) return reply.code(404).send({ error: "Школа не найдена в этом контуре" });
      const candidates = await prisma.user.findMany({
        where: {
          platformRole: null, isBlocked: false,
          ...(isTest === true ? { maxUserId: null, testProfileKey: { not: null } } : isTest === false ? { testProfileKey: null } : {}),
          AND: [
            { OR: [
              { memberships: { none: { active: true } } },
              { memberships: { some: { schoolId, active: true, approved: true, role: { in: ["STUDENT", "TEACHER"] }, isSchoolAdmin: false } } },
            ] },
            { memberships: { none: { schoolId: { not: schoolId }, active: true } } },
          ],
        },
        select: { id: true, displayName: true, firstName: true, lastName: true },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
      });
      return candidates.map((user) => ({ id: user.id, name: displayUserName(user), role: "STUDENT" as const }));
    }
    if (schoolId) {
      const school = await prisma.school.findFirst({ where: { id: schoolId, ...schoolVisibility(isTest) }, select: { id: true } });
      if (!school) return reply.code(404).send({ error: "Школа не найдена в этом контуре" });
    }
    const rawQuery = params.q?.normalize("NFKC").trim().replace(/\s+/gu, " ").slice(0, 120) ?? "";
    const tokens = rawQuery.split(" ").filter(Boolean);
    const role = params.role === "student" || params.role === "teacher" || params.role === "admin" ? params.role : "all";
    const status = params.status === "active" || params.status === "pending" || params.status === "former" ? params.status : "all";
    const requestedPage = Number.parseInt(params.page ?? "1", 10);
    const requestedSize = Number.parseInt(params.pageSize ?? "25", 10);
    const page = Number.isFinite(requestedPage) ? Math.max(1, Math.min(100_000, requestedPage)) : 1;
    const pageSize = Number.isFinite(requestedSize) ? Math.max(10, Math.min(100, requestedSize)) : 25;
    const roleWhere: Prisma.MembershipWhereInput = role === "student" ? { role: "STUDENT" } : role === "teacher" ? { OR: [{ role: "TEACHER" }, { isTeacher: true }] } : role === "admin" ? { OR: [{ role: "SCHOOL_ADMIN" }, { isSchoolAdmin: true }] } : {};
    const statusWhere: Prisma.MembershipWhereInput = status === "active" ? { active: true, approved: true } : status === "pending" ? { active: true, approved: false } : status === "former" ? { active: false } : {};
    const searchWhere: Prisma.UserWhereInput = tokens.length ? { AND: tokens.map((token) => ({ OR: queryVariants(token).flatMap((variant) => [{ firstName: { contains: variant } }, { lastName: { contains: variant } }, { middleName: { contains: variant } }, { displayName: { contains: variant } }]) })) } : {};
    const where: Prisma.MembershipWhereInput = {
      school: { ...schoolVisibility(isTest) },
      ...(schoolId ? { schoolId } : {}), ...roleWhere, ...statusWhere,
      ...(tokens.length ? { user: searchWhere } : {}),
    };
    const [rows, total] = await prisma.$transaction([
      prisma.membership.findMany({
        where, skip: (page - 1) * pageSize, take: pageSize,
        include: { user: { select: { id: true, firstName: true, lastName: true, middleName: true, displayName: true, isBlocked: true } }, school: { select: { id: true, name: true } }, schoolClass: { select: { id: true, name: true } } },
        orderBy: [{ user: { lastName: "asc" } }, { user: { firstName: "asc" } }, { school: { name: "asc" } }, { id: "asc" }],
      }),
      prisma.membership.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id, userId: row.user.id, name: displayUserName(row.user), firstName: row.user.firstName, lastName: row.user.lastName,
        schoolId: row.school.id, schoolName: row.school.name, className: row.schoolClass?.name ?? null,
        roles: [...new Set([...(row.role === "STUDENT" ? ["STUDENT"] : []), ...(row.role === "TEACHER" || row.isTeacher ? ["TEACHER"] : []), ...(row.role === "SCHOOL_ADMIN" || row.isSchoolAdmin ? ["SCHOOL_ADMIN"] : [])])],
        status: row.user.isBlocked ? "blocked" : !row.active ? "former" : row.approved ? "active" : "pending",
        joinedAt: row.createdAt, blockedReason: row.blockedReason,
      })),
      page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)),
    };
  });

  app.post("/api/owner/schools", async (request, reply) => {
    const context = await requireRole(request, reply, ["PROJECT_OWNER"]);
    if (!context) return;
    const parsed = z.object({ name: z.string().trim().min(3).max(150), city: z.string().trim().min(2).max(100), timezone: z.string().min(3).max(80).refine(timezoneIsValid, "Неизвестный часовой пояс"), requestKey: z.string().min(16).max(100) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Проверьте название, город и часовой пояс" });
    const data = { name: parsed.data.name.normalize("NFKC").trim().replace(/\s+/gu, " "), city: parsed.data.city.normalize("NFKC").trim().replace(/\s+/gu, " "), timezone: parsed.data.timezone, requestKey: parsed.data.requestKey, isSynthetic: false };
    const previous = await prisma.school.findUnique({ where: { requestKey: data.requestKey } });
    if (previous) return previous.name === data.name && previous.city === data.city && previous.isSynthetic === data.isSynthetic ? reply.code(200).send(previous) : reply.code(409).send({ error: "Ключ операции уже использован с другими данными" });
    try {
      const school = await prisma.$transaction(async (tx) => {
        const row = await tx.school.create({ data });
        await tx.auditLog.create({ data: { actorId: context.user.id, schoolId: row.id, action: "SCHOOL_CREATED", objectType: "School", objectId: row.id, changesJson: JSON.stringify({ name: row.name, city: row.city, timezone: row.timezone }) } });
        return row;
      });
      return reply.code(201).send(school);
    } catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "P2002") return reply.code(409).send({ error: "Школа с таким названием уже существует в этом городе" }); throw error; }
  });

  app.patch<{ Params: { id: string } }>("/api/owner/schools/:id", async (request, reply) => {
    const context = await requireRole(request, reply, ["PROJECT_OWNER"]);
    if (!context) return;
    const parsed = z.object({ name: z.string().trim().min(3).max(150).optional(), city: z.string().trim().min(2).max(100).optional(), timezone: z.string().min(3).max(80).refine(timezoneIsValid, "Неизвестный часовой пояс").optional() }).strict().safeParse(request.body);
    if (!parsed.success || Object.keys(parsed.data).length === 0) return reply.code(400).send({ error: "Добавьте новое значение школы" });
    const isTest = null;
    const before = await prisma.school.findFirst({ where: { id: request.params.id, ...schoolVisibility(isTest) } });
    if (!before) return reply.code(404).send({ error: "Школа не найдена" });
    if (parsed.data.timezone && parsed.data.timezone !== before.timezone) {
      const hasHistory = await prisma.membership.count({ where: { schoolId: before.id, OR: [{ activityDays: { some: {} } }, { ledger: { some: {} } }, { submissions: { some: {} } }] } });
      if (hasHistory) return reply.code(409).send({ error: "Часовой пояс нельзя менять после активности: так сохраняются исторические дни серии и начислений." });
    }
    let school;
    try { school = await prisma.school.update({ where: { id: before.id }, data: parsed.data }); }
    catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "P2002") return reply.code(409).send({ error: "Школа с таким названием уже существует в этом городе" }); throw error; }
    await audit(context.user.id, school.id, "SCHOOL_UPDATED", "School", school.id, { before: { name: before.name, city: before.city, timezone: before.timezone }, after: parsed.data });
    return school;
  });

  app.post<{ Params: { id: string } }>("/api/owner/schools/:id/admin", async (request, reply) => {
    const context = await requireRole(request, reply, ["PROJECT_OWNER"]);
    if (!context) return;
    const parsed = z.object({ userId: z.string(), enabled: z.boolean().default(true) }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Укажите существующий аккаунт пользователя" });
    const isTest = null;
    const membershipScope: Prisma.UserWhereInput[] = parsed.data.enabled ? [
      { OR: [
        { memberships: { none: { active: true } } },
        { memberships: { some: { schoolId: request.params.id, active: true, approved: true, role: { in: ["STUDENT", "TEACHER"] }, isSchoolAdmin: false } } },
      ] },
      { memberships: { none: { schoolId: { not: request.params.id }, active: true } } },
    ] : [
      { memberships: { some: { schoolId: request.params.id, active: true, approved: true, role: "SCHOOL_ADMIN", isSchoolAdmin: true } } },
      { memberships: { none: { schoolId: { not: request.params.id }, active: true } } },
    ];
    const [school, user] = await Promise.all([
      prisma.school.findFirst({ where: { id: request.params.id, ...schoolVisibility(isTest), archivedAt: null } }),
      prisma.user.findFirst({ where: { id: parsed.data.userId, ...(isTest === true ? { testProfileKey: { not: null }, maxUserId: null } : isTest === false ? { testProfileKey: null } : {}), platformRole: null, isBlocked: false, AND: membershipScope } }),
    ]);
    if (!school || !user) return reply.code(404).send({ error: "Школа или допустимый аккаунт этого контура не найдены" });
    const existing = await prisma.membership.findUnique({ where: { userId_schoolId: { userId: user.id, schoolId: school.id } } });
    if (parsed.data.enabled) {
      const elsewhere = await prisma.membership.findFirst({ where: { userId: user.id, schoolId: { not: school.id }, active: true, approved: true } });
      if (elsewhere) return reply.code(409).send({ error: "Пользователь уже состоит в другой школе. Сначала выполните отдельный подтверждённый перевод; назначение не перемещает людей автоматически." });
      const membership = await prisma.$transaction(async (tx) => {
        const row = await tx.membership.upsert({ where: { userId_schoolId: { userId: user.id, schoolId: school.id } }, create: { userId: user.id, schoolId: school.id, role: "SCHOOL_ADMIN", isSchoolAdmin: true }, update: { active: true, approved: true, role: "SCHOOL_ADMIN", isSchoolAdmin: true, isTeacher: Boolean(existing?.isTeacher || existing?.role === "TEACHER"), blockedReason: null } });
        await tx.auditLog.create({ data: { actorId: context.user.id, schoolId: school.id, action: "SCHOOL_ADMIN_ASSIGNED", objectType: "Membership", objectId: row.id } });
        return row;
      });
      return { ok: true, membershipId: membership.id, enabled: true };
    }
    if (!existing || (!existing.isSchoolAdmin && existing.role !== "SCHOOL_ADMIN")) return { ok: true, membershipId: existing?.id ?? null, enabled: false, unchanged: true };
    const membership = await prisma.$transaction(async (tx) => {
      const row = await tx.membership.update({ where: { id: existing.id }, data: { role: existing.isTeacher ? "TEACHER" : "STUDENT", isSchoolAdmin: false } });
      await tx.auditLog.create({ data: { actorId: context.user.id, schoolId: school.id, action: "SCHOOL_ADMIN_REMOVED", objectType: "Membership", objectId: row.id } });
      return row;
    });
    return { ok: true, membershipId: membership.id, enabled: false };
  });

  app.post<{ Params: { id: string } }>("/api/owner/schools/:id/archive", async (request, reply) => {
    const context = await requireRole(request, reply, ["PROJECT_OWNER"]);
    if (!context) return;
    const isTest = null;
    const result = await prisma.$transaction(async (tx) => {
      const school = await tx.school.findFirst({ where: { id: request.params.id, ...schoolVisibility(isTest), archivedAt: null } });
      if (!school) return { missing: true as const };
      await tx.$executeRaw`UPDATE "School" SET "name" = "name" WHERE "id" = ${school.id}`;
      const pending = await tx.submission.count({ where: { assignment: { schoolId: school.id }, status: { in: [...pendingSubmissionStatuses] } } });
      if (pending) return { blocked: true as const, pending };
      const archivedAt = new Date();
      await tx.school.update({ where: { id: school.id }, data: { archivedAt } });
      const pendingRequests = await tx.membership.updateMany({ where: { schoolId: school.id, active: true, approved: false }, data: { active: false, blockedReason: "Школа архивирована владельцем проекта" } });
      await tx.auditLog.create({ data: { actorId: context.user.id, schoolId: school.id, action: "SCHOOL_ARCHIVED", objectType: "School", objectId: school.id, changesJson: JSON.stringify({ name: school.name, pendingRequestsDeactivated: pendingRequests.count }) } });
      return { archived: true as const, archivedAt, pendingRequestsDeactivated: pendingRequests.count };
    });
    if ("missing" in result) return reply.code(404).send({ error: "Действующая школа не найдена" });
    if ("blocked" in result) return reply.code(409).send({ error: `Нельзя архивировать школу: осталось ${result.pending} незавершённых сдач. Завершите или передайте проверки.` });
    return result;
  });

  app.post<{ Params: { id: string } }>("/api/owner/schools/:id/restore", async (request, reply) => {
    const context = await requireRole(request, reply, ["PROJECT_OWNER"]);
    if (!context) return;
    const school = await prisma.school.findFirst({ where: { id: request.params.id, ...schoolVisibility(null), archivedAt: { not: null } } });
    if (!school) return reply.code(404).send({ error: "Архивная школа не найдена" });
    await prisma.$transaction(async (tx) => {
      await tx.school.update({ where: { id: school.id }, data: { archivedAt: null } });
      await tx.auditLog.create({ data: { actorId: context.user.id, schoolId: school.id, action: "SCHOOL_RESTORED", objectType: "School", objectId: school.id, changesJson: JSON.stringify({ name: school.name }) } });
    });
    return { ok: true, restored: true, membershipsRestored: false };
  });

  app.delete<{ Params: { id: string } }>("/api/owner/schools/:id", async (request, reply) => {
    const context = await requireRole(request, reply, ["PROJECT_OWNER"]);
    if (!context) return;
    const result = await prisma.$transaction(async (tx) => {
      const school = await tx.school.findFirst({ where: { id: request.params.id, ...schoolVisibility(null) } });
      if (!school) return { missing: true as const };
      await tx.$executeRaw`UPDATE "School" SET "name" = "name" WHERE "id" = ${school.id}`;
      const [memberships, classes, assignments, products] = await Promise.all([
        tx.membership.count({ where: { schoolId: school.id } }), tx.schoolClass.count({ where: { schoolId: school.id } }),
        tx.assignment.count({ where: { schoolId: school.id } }), tx.product.count({ where: { schoolId: school.id } }),
      ]);
      if (memberships || classes || assignments || products) return { blocked: true as const, dependencies: { memberships, classes, assignments, products } };
      await tx.auditLog.create({ data: { actorId: context.user.id, schoolId: school.id, action: "EMPTY_SCHOOL_DELETED", objectType: "School", objectId: school.id, changesJson: JSON.stringify({ name: school.name, city: school.city }) } });
      await tx.school.delete({ where: { id: school.id } });
      return { deleted: true as const };
    });
    if ("missing" in result) return reply.code(404).send({ error: "Школа не найдена в вашем контуре" });
    if ("blocked" in result) return reply.code(409).send({ error: "Школу с историей нельзя удалить. Используйте архивирование; данные и связи сохранятся.", ...result.dependencies });
    return { ok: true, deleted: true };
  });

  app.get("/api/owner/products", async (request, reply) => {
    const context = await requireRole(request, reply, ["PROJECT_OWNER"]);
    if (!context) return;
    const products = await prisma.product.findMany({ where: { scope: "GLOBAL" }, include: { image: { select: { id: true } } }, orderBy: [{ active: "desc" }, { name: "asc" }] });
    return products.map(({ image, ...product }) => ({ ...product, imageUrl: image ? `/api/market/products/${product.id}/image` : null }));
  });

  app.patch<{ Params: { id: string } }>("/api/owner/products/:id", async (request, reply) => {
    const context = await requireRole(request, reply, ["PROJECT_OWNER"]);
    if (!context) return;
    const parsed = z.object({ name: z.string().trim().min(2).max(120).optional(), description: z.string().trim().min(1).max(2000).optional(), category: z.string().trim().min(1).max(80).optional(), imageKey: z.string().regex(/^[a-z0-9-]+$/u).optional(), price: z.number().int().min(1).max(100_000).optional(), stock: z.number().int().min(0).max(100_000).optional(), perUserLimit: z.number().int().min(1).max(100).optional(), active: z.boolean().optional() }).strict().safeParse(request.body);
    if (!parsed.success || !Object.keys(parsed.data).length) return reply.code(400).send({ error: "Проверьте поля изменения товара" });
    const product = await prisma.product.findFirst({ where: { id: request.params.id, scope: "GLOBAL" } });
    if (!product) return reply.code(404).send({ error: "Товар не найден в вашем контуре" });
    const updated = await prisma.product.update({ where: { id: product.id }, data: { ...parsed.data, isSynthetic: false } });
    await audit(context.user.id, null, parsed.data.active === false ? "GLOBAL_PRODUCT_ARCHIVED" : "GLOBAL_PRODUCT_UPDATED", "Product", product.id, { before: { name: product.name, active: product.active }, after: parsed.data });
    return updated;
  });

  app.post("/api/owner/products", async (request, reply) => {
    const context = await requireRole(request, reply, ["PROJECT_OWNER"]);
    if (!context) return;
    const parsed = z.object({ name: z.string().trim().min(2).max(120), description: z.string().trim().min(1).max(2000), category: z.string().trim().min(1).max(80), imageKey: z.string().regex(/^[a-z0-9-]+$/u), price: z.number().int().min(1).max(100_000), stock: z.number().int().min(0).max(100_000), perUserLimit: z.number().int().min(1).max(100).default(1) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Проверьте поля товара" });
    const slug = `${parsed.data.imageKey}-${Date.now().toString(36)}`;
    const product = await prisma.product.create({ data: { ...parsed.data, slug, scope: "GLOBAL", isSynthetic: false } });
    await audit(context.user.id, null, "GLOBAL_PRODUCT_CREATED", "Product", product.id, { slug, name: product.name });
    return reply.code(201).send(product);
  });
}
