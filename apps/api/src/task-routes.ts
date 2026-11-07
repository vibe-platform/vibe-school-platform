import type { FastifyInstance } from "fastify";
import type { Assignment, Membership, Question, Submission } from "@prisma/client";
import { z } from "zod";
import { gradeFromPercent, normalizeAnswer, numericAnswerMatches } from "@vibe/shared";
import { prisma } from "./db.js";
import { grantReward } from "./rewards.js";
import { notifyEvent, notifyLevelUp } from "./notifications.js";
import { requireAuth, requireRole } from "./security.js";
import { displayUserName } from "./display-name.js";
import { pendingActivityDayKeys } from "./dates.js";

const questionInput = z.object({
  prompt: z.string().trim().min(1, "Укажите текст вопроса").max(2000, "Текст вопроса слишком длинный"),
  type: z.enum(["SHORT_TEXT", "NUMBER", "SINGLE_CHOICE", "LONG_ANSWER"]),
  points: z.number().int().min(1).max(100),
  options: z.array(z.string().trim().min(1).max(200)).max(8).default([]),
  acceptedAnswers: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  tolerance: z.number().min(0).max(1_000_000).default(0),
  ignoreCase: z.boolean().default(true),
  trimWhitespace: z.boolean().default(true),
  photoRequired: z.boolean().default(false),
});
const assignmentInput = z.object({
  title: z.string().trim().min(1, "Укажите название работы").max(120, "Название работы слишком длинное"), subject: z.string().trim().min(1, "Укажите предмет").max(100, "Название предмета слишком длинное"),
  category: z.enum(["Учёба", "Творчество", "Спорт", "Волонтёрство", "Школьная жизнь"]),
  description: z.string().trim().min(1, "Добавьте описание работы").max(8000, "Описание работы слишком длинное"), classIds: z.array(z.string()).min(1, "Выберите хотя бы один класс").max(10, "Можно выбрать не больше 10 классов"),
  dueAt: z.string().datetime().nullable().optional(), durationMinutes: z.number().int().min(1).max(240).nullable().optional(),
  questions: z.array(questionInput).min(1).max(40),
  photoFileIds: z.array(z.string()).max(5).default([]),
  publish: z.boolean().default(false),
});
const answersInput = z.object({ answers: z.array(z.object({ questionId: z.string(), text: z.string().max(8000).default(""), fileIds: z.array(z.string()).max(5).default([]) })).max(40) });

const questionDto = (question: Question) => ({
  id: question.id, prompt: question.prompt, type: question.type, points: question.points,
  options: JSON.parse(question.optionsJson) as string[], photoRequired: question.photoRequired, sortOrder: question.sortOrder,
});

async function studentAssignment(assignmentId: string, membership: Membership) {
  return prisma.assignment.findFirst({
    where: { id: assignmentId, schoolId: membership.schoolId, published: true, archived: false, targets: { some: { recipients: { some: { id: membership.id } } } } },
    include: { questions: { orderBy: { sortOrder: "asc" } }, targets: true, uploads: { select: { id: true } } },
  });
}

async function teacherAssignment(assignmentId: string, membership: Membership, userId: string, includeOwnHistory = false) {
  const assignedClasses = await prisma.teacherClass.findMany({ where: { teacherId: membership.id, active: true, schoolClass: { archivedAt: null } }, select: { classId: true } });
  const classIds = assignedClasses.map((row) => row.classId);
  return prisma.assignment.findFirst({
    where: {
      id: assignmentId, schoolId: membership.schoolId, teacherId: userId,
      ...(includeOwnHistory ? {} : { targets: { some: { classId: { in: classIds } } } }),
    },
    include: { questions: { orderBy: { sortOrder: "asc" } }, uploads: { select: { id: true } }, targets: { include: { recipients: { select: { id: true, user: { select: { firstName: true, lastName: true } } } } } } },
  });
}

function calculateQuickGrade(questions: Question[], responses: Map<string, string>) {
  let maxPoints = 0; let earnedPoints = 0;
  const perQuestion = new Map<string, number>();
  for (const question of questions) {
    maxPoints += question.points;
    const answer = responses.get(question.id) ?? "";
    const accepted = JSON.parse(question.acceptedJson) as string[];
    let correct = false;
    if (question.type === "NUMBER" && accepted.length) {
      correct = accepted.some((item) => numericAnswerMatches(answer, Number(item.replace(",", ".")), question.tolerance));
    } else if (question.type === "SHORT_TEXT" || question.type === "SINGLE_CHOICE") {
      const candidate = normalizeAnswer(answer, { ignoreCase: question.ignoreCase, trimWhitespace: question.trimWhitespace });
      correct = accepted.some((item) => candidate === normalizeAnswer(item, { ignoreCase: question.ignoreCase, trimWhitespace: question.trimWhitespace }));
    }
    const score = correct ? question.points : 0;
    perQuestion.set(question.id, score); earnedPoints += score;
  }
  return { maxPoints, earnedPoints, grade: gradeFromPercent(earnedPoints / maxPoints * 100), perQuestion };
}

async function putAnswers(submission: Submission, assignment: Assignment & { questions: Question[] }, membership: Membership, userId: string, data: z.infer<typeof answersInput>["answers"]) {
  const allowedQuestionIds = new Set(assignment.questions.map((question) => question.id));
  if (data.some((answer) => !allowedQuestionIds.has(answer.questionId)) || new Set(data.map((answer) => answer.questionId)).size !== data.length) throw new Error("В ответе есть неизвестный или повторный вопрос");
  const priorAnswers = await prisma.answer.findMany({ where: { submissionId: submission.id }, include: { uploads: { select: { id: true } } } });
  const priorAnswerIds = priorAnswers.map((answer) => answer.id);
  if (priorAnswerIds.length) await prisma.upload.updateMany({ where: { answerId: { in: priorAnswerIds }, id: { notIn: data.flatMap((answer) => answer.fileIds) } }, data: { answerId: null, expiresAt: new Date(Date.now() + 24 * 60 * 60_000) } });
  const fileIds = [...new Set(data.flatMap((answer) => answer.fileIds))];
  const uploads = fileIds.length ? await prisma.upload.findMany({ where: { id: { in: fileIds }, userId, membershipId: membership.id, OR: [{ answerId: null }, { answerId: { in: priorAnswerIds } }] } }) : [];
  if (uploads.length !== fileIds.length) throw new Error("Фото отсутствует, просрочено или принадлежит другой сдаче");
  for (const item of data) {
    const answer = await prisma.answer.upsert({
      where: { submissionId_questionId: { submissionId: submission.id, questionId: item.questionId } },
      create: { submissionId: submission.id, questionId: item.questionId, textValue: item.text },
      update: { textValue: item.text },
    });
    const previousIds = priorAnswers.find((previous) => previous.questionId === item.questionId)?.uploads.map((upload) => upload.id) ?? [];
    if (previousIds.length) await prisma.upload.updateMany({ where: { id: { in: previousIds, notIn: item.fileIds } }, data: { answerId: null } });
    if (item.fileIds.length) await prisma.upload.updateMany({ where: { id: { in: item.fileIds }, userId, membershipId: membership.id }, data: { answerId: answer.id, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000) } });
  }
}

function effectiveDeadline(assignment: Assignment, submission: Pick<Submission, "startedAt" | "extendedDueAt">) {
  const deadlines: Date[] = [];
  if (submission.extendedDueAt) deadlines.push(submission.extendedDueAt);
  else if (assignment.dueAt) deadlines.push(assignment.dueAt);
  if (assignment.durationMinutes && submission.startedAt) deadlines.push(new Date(submission.startedAt.getTime() + assignment.durationMinutes * 60_000));
  return deadlines.length ? new Date(Math.min(...deadlines.map((date) => date.getTime()))) : null;
}

export async function registerTaskRoutes(app: FastifyInstance) {
  app.get("/api/teacher/class-options", async (request, reply) => {
    const context = await requireRole(request, reply, ["TEACHER"]);
    if (!context) return;
    if (!context.membership) return [];
    const [classes, selected] = await Promise.all([
      prisma.schoolClass.findMany({ where: { schoolId: context.membership.schoolId, archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
      prisma.teacherClass.findMany({ where: { teacherId: context.membership.id, active: true, schoolClass: { schoolId: context.membership.schoolId, archivedAt: null } }, select: { classId: true } }),
    ]);
    const ids = new Set(selected.map((row) => row.classId));
    return classes.map((row) => ({ ...row, selected: ids.has(row.id) }));
  });
  app.put("/api/teacher/classes", async (request, reply) => {
    const context = await requireRole(request, reply, ["TEACHER"]);
    if (!context) return;
    if (!context.membership) return reply.code(403).send({ error: "Нет школы в сессии" });
    const parsed = z.object({ classIds: z.array(z.string()).max(100) }).strict().safeParse(request.body);
    if (!parsed.success || new Set(parsed.data.classIds).size !== parsed.data.classIds.length) return reply.code(400).send({ error: "Список классов должен быть корректным и без повторов" });
    const membership = context.membership;
    const valid = await prisma.schoolClass.findMany({ where: { id: { in: parsed.data.classIds }, schoolId: membership.schoolId, archivedAt: null }, select: { id: true } });
    if (valid.length !== parsed.data.classIds.length) return reply.code(400).send({ error: "Выбранный класс относится к другой школе, архивирован или не существует" });
    const current = await prisma.teacherClass.findMany({ where: { teacherId: membership.id, active: true }, select: { classId: true } });
    const removed = current.map((row) => row.classId).filter((id) => !parsed.data.classIds.includes(id));
    await prisma.$transaction(async (tx) => {
      if (parsed.data.classIds.length && (membership.role === "SCHOOL_ADMIN" || membership.isSchoolAdmin) && !membership.isTeacher) await tx.membership.update({ where: { id: membership.id }, data: { isTeacher: true } });
      await tx.teacherClass.updateMany({ where: { teacherId: membership.id, classId: { in: removed } }, data: { active: false } });
      for (const classId of parsed.data.classIds) await tx.teacherClass.upsert({ where: { teacherId_classId: { teacherId: membership.id, classId } }, create: { teacherId: membership.id, classId, active: true }, update: { active: true } });
      await tx.auditLog.create({ data: { actorId: context.user.id, schoolId: membership.schoolId, action: "TEACHER_SELF_CLASSES_UPDATED", objectType: "Membership", objectId: membership.id, changesJson: JSON.stringify({ before: current.map((row) => row.classId), after: parsed.data.classIds }) } });
    });
    return { ok: true, classIds: parsed.data.classIds };
  });
  app.get("/api/teacher/classes", async (request, reply) => {
    const context = await requireRole(request, reply, ["TEACHER"]);
    if (!context) return;
    if (!context.membership) return [];
    const rows = await prisma.teacherClass.findMany({ where: { teacherId: context.membership.id, active: true, schoolClass: { schoolId: context.membership.schoolId, archivedAt: null } }, include: { schoolClass: { select: { id: true, name: true } } }, orderBy: { schoolClass: { name: "asc" } } });
    return rows.map(({ schoolClass }) => schoolClass);
  });
  app.get("/api/tasks", async (request, reply) => {
    const context = await requireAuth(request, reply);
    if (!context) return;
    const membership = context.membership;
    if (!membership && context.user.platformRole === "PROJECT_OWNER") return { tasks: [], nextAction: { title: "Панель владельца", detail: "Управляйте проектом и школами.", href: "/owner", kind: "OWNER" }, waitingForReview: 0, waitingForReviewDays: 0 };
    if (!membership) return { tasks: [], nextAction: { title: "Присоединитесь к школе", detail: "Для работ нужна подтверждённая школьная принадлежность.", href: "/onboarding", kind: "ONBOARDING" }, waitingForReview: 0, waitingForReviewDays: 0 };
    if (membership.role === "STUDENT" && !membership.isSchoolAdmin && context.user.platformRole !== "PROJECT_OWNER") {
      const rows = await prisma.assignment.findMany({
        where: { schoolId: membership.schoolId, published: true, archived: false, targets: { some: { recipients: { some: { id: membership.id } } } } },
        include: { questions: true, submissions: { where: { membershipId: membership.id }, orderBy: { attempt: "desc" }, take: 1 } },
        orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
      });
      const tasks = rows.map((assignment) => {
        const submission = assignment.submissions[0] ?? null;
        let status = submission?.status ?? "AVAILABLE";
        if (assignment.dueAt && assignment.dueAt < new Date() && (!submission || ["IN_PROGRESS", "RETURNED", "AVAILABLE"].includes(status))) status = "OVERDUE";
        return { id: assignment.id, title: assignment.title, subject: assignment.subject, category: assignment.category, dueAt: assignment.dueAt, durationMinutes: assignment.durationMinutes, questionCount: assignment.questions.length, hasLongAnswer: assignment.questions.some((question) => question.type === "LONG_ANSWER"), reward: "За оценку 4–5 — база 10 Эйнштейнов, за 2–3 — база 5; применяется множитель серии. +1 EXP за первый зачёт работы.", status, submissionId: submission?.id ?? null, submittedAt: submission?.submittedAt ?? null };
      });
      const byPriority = ["IN_PROGRESS", "RETURNED", "AVAILABLE"];
      let next = null as null | { title: string; detail: string; href: string; kind: string };
      for (const status of byPriority) {
        const found = tasks.filter((task) => task.status === status).sort((a, b) => (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity))[0];
        if (found) {
          const action = status === "IN_PROGRESS" ? "Продолжить" : status === "RETURNED" ? "Доработать" : "Открыть";
          next = { title: `${action}: ${found.title}`, detail: found.dueAt ? `Срок до ${new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(found.dueAt)}` : "Работа доступна без общего срока", href: `/tasks/${found.id}`, kind: status };
          break;
        }
      }
      const waitingForReview = tasks.filter((task) => task.status === "SUBMITTED").length;
      const school = await prisma.school.findUnique({ where: { id: membership.schoolId }, select: { timezone: true } });
      const confirmedDays = new Set((await prisma.activityDay.findMany({ where: { membershipId: membership.id }, select: { dayKey: true } })).map((row) => row.dayKey));
      const pendingActivityDays = pendingActivityDayKeys(tasks.filter((task) => task.status === "SUBMITTED").map((task) => task.submittedAt), confirmedDays, school?.timezone ?? "Europe/Moscow");
      return { tasks, nextAction: next ?? { title: waitingForReview ? "Всё отправлено" : "Пока нет новых заданий", detail: waitingForReview ? `${waitingForReview} работ ждут проверки.` : "Новые работы появятся здесь.", href: "/tasks", kind: "EMPTY" }, waitingForReview, waitingForReviewDays: pendingActivityDays.length, pendingActivityDays };
    }
    const rows = await prisma.assignment.findMany({ where: { schoolId: membership.schoolId, teacherId: context.user.id, archived: false }, include: { questions: true, _count: { select: { submissions: true } } }, orderBy: { createdAt: "desc" } });
    return { tasks: rows.map((assignment) => ({ id: assignment.id, title: assignment.title, subject: assignment.subject, category: assignment.category, dueAt: assignment.dueAt, durationMinutes: assignment.durationMinutes, questionCount: assignment.questions.length, hasLongAnswer: assignment.questions.some((question) => question.type === "LONG_ANSWER"), status: assignment.published ? "PUBLISHED" : "DRAFT", assignedCount: assignment._count.submissions, previewOnly: true })), nextAction: context.user.platformRole === "PROJECT_OWNER" ? { title: "Панель владельца", detail: "Управляйте проектом и школами.", href: "/owner", kind: "OWNER" } : (membership.role === "SCHOOL_ADMIN" || membership.isSchoolAdmin) ? { title: "Панель управления школой", detail: "Управляйте классами, пользователями и школьными возможностями в одном месте.", href: "/admin", kind: "ADMIN" } : { title: "Ваши работы", detail: "Предпросмотр учителя не начисляет наград.", href: "/teacher", kind: "TEACHER" }, waitingForReview: 0 };
  });

  app.get<{ Params: { id: string } }>("/api/tasks/:id", async (request, reply) => {
    const context = await requireAuth(request, reply);
    if (!context) return;
    if (!context.membership) return reply.code(403).send({ error: "Сначала присоединитесь к школе" });
    const isStudent = context.membership.role === "STUDENT" && !context.membership.isSchoolAdmin;
    const canTeach = context.membership.role === "TEACHER" || context.membership.isTeacher || context.membership.role === "SCHOOL_ADMIN" || context.membership.isSchoolAdmin;
    const assignment = isStudent ? await studentAssignment(request.params.id, context.membership) : canTeach ? await teacherAssignment(request.params.id, context.membership, context.user.id, true) : null;
    if (!assignment) return reply.code(404).send({ error: "Работа не найдена или недоступна" });
    const latest = isStudent ? await prisma.submission.findFirst({ where: { assignmentId: assignment.id, membershipId: context.membership.id }, orderBy: { attempt: "desc" }, include: { answers: { include: { uploads: { select: { id: true, mimeType: true } } } } } }) : null;
    const questions = assignment.questions.map(questionDto);
    const rewardEntries = latest?.rewardGranted ? await prisma.ledgerEntry.findMany({ where: { membershipId: context.membership.id, referenceId: latest.id, kind: { in: ["TASK_REWARD", "STREAK_ADJUSTMENT"] } }, orderBy: { createdAt: "asc" } }) : [];
    const firstReward = rewardEntries.find((entry) => entry.kind === "TASK_REWARD");
    return {
      id: assignment.id, title: assignment.title, subject: assignment.subject, category: assignment.category, description: assignment.description,
      dueAt: assignment.dueAt, durationMinutes: assignment.durationMinutes, questions, photos: assignment.uploads.map((file) => ({ id: file.id, url: `/api/files/${file.id}` })), previewOnly: !isStudent,
      submission: latest ? { id: latest.id, status: latest.status, startedAt: latest.startedAt, submittedAt: latest.submittedAt, checkedAt: latest.checkedAt, grade: latest.grade, earnedPoints: latest.earnedPoints, maxPoints: latest.maxPoints, teacherComment: latest.teacherComment, deadline: effectiveDeadline(assignment, latest), reward: firstReward ? { einsteins: rewardEntries.reduce((sum, entry) => sum + entry.amount, 0), exp: firstReward.expAmount, note: firstReward.note } : null, answers: latest.answers.map((answer) => ({ questionId: answer.questionId, text: answer.textValue, fileIds: answer.uploads.map((file) => file.id) })) } : null,
    };
  });

  app.post<{ Params: { id: string } }>("/api/tasks/:id/start", async (request, reply) => {
    const context = await requireAuth(request, reply);
    if (!context) return;
    if (!context.membership || context.membership.role !== "STUDENT") return reply.code(403).send({ error: "Работу сдаёт ученик" });
    const assignment = await studentAssignment(request.params.id, context.membership);
    if (!assignment) return reply.code(404).send({ error: "Работа не найдена или не назначена вам" });
    const latest = await prisma.submission.findFirst({ where: { assignmentId: assignment.id, membershipId: context.membership.id }, orderBy: { attempt: "desc" } });
    if (latest?.status === "IN_PROGRESS") return { submissionId: latest.id, startedAt: latest.startedAt, deadline: effectiveDeadline(assignment, latest) };
    if (["COMPLETED", "SUBMITTED"].includes(latest?.status ?? "")) return reply.code(409).send({ error: "Эта работа уже отправлена" });
    const extension = latest?.status === "RETURNED" ? latest.extendedDueAt : null;
    if (!extension && assignment.dueAt && assignment.dueAt < new Date()) return reply.code(410).send({ error: "Срок работы закончился" });
    if (extension && extension < new Date()) return reply.code(410).send({ error: "Срок доработки закончился" });
    const startedAt = new Date();
    const submission = await prisma.submission.create({ data: { assignmentId: assignment.id, membershipId: context.membership.id, attempt: (latest?.attempt ?? 0) + 1, status: "IN_PROGRESS", startedAt, extendedDueAt: extension } });
    return { submissionId: submission.id, startedAt, deadline: effectiveDeadline(assignment, submission) };
  });

  const saveHandler = async (request: Parameters<typeof requireAuth>[0], reply: Parameters<typeof requireAuth>[1], finalSubmit: boolean, assignmentId: string) => {
    const context = await requireAuth(request, reply);
    if (!context) return;
    if (!context.membership || context.membership.role !== "STUDENT") return reply.code(403).send({ error: "Ответы доступны только ученику" });
    const parsed = answersInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Проверьте ответы и список фото" });
    const assignment = await studentAssignment(assignmentId, context.membership);
    if (!assignment) return reply.code(404).send({ error: "Работа недоступна" });
    const submissionId = request.headers["x-submission-id"];
    if (typeof submissionId !== "string") return reply.code(400).send({ error: "Начните выполнение, чтобы сохранить ответы" });
    const submission = await prisma.submission.findFirst({ where: { id: submissionId, assignmentId: assignment.id, membershipId: context.membership.id } });
    if (!submission || !["IN_PROGRESS", "RETURNED"].includes(submission.status)) return reply.code(403).send({ error: "Эта сдача не принадлежит вам или уже закрыта" });
    const deadline = effectiveDeadline(assignment, submission);
    if (deadline && deadline < new Date()) return reply.code(410).send({ error: "Время вышло. Сервер завершит сдачу по последнему черновику." });
    try { await putAnswers(submission, assignment, context.membership, context.user.id, parsed.data.answers); }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Не удалось сохранить ответы" }); }
    if (!finalSubmit) return { ok: true, savedAt: new Date(), status: "Черновик сохранён" };
    const answers = await prisma.answer.findMany({ where: { submissionId: submission.id }, include: { question: true, uploads: true } });
    const answerByQuestion = new Map(answers.map((answer) => [answer.questionId, answer]));
    if (assignment.questions.some((question) => question.photoRequired && !(answerByQuestion.get(question.id)?.uploads.length))) return reply.code(400).send({ error: "Для развёрнутого ответа добавьте хотя бы одно фото" });
    const nonEmpty = answers.some((answer) => answer.textValue.trim() || answer.uploads.length);
    if (!nonEmpty) return reply.code(400).send({ error: "Пустую работу отправить нельзя" });
    const isManual = assignment.questions.some((question) => question.type === "LONG_ANSWER");
    const grade = calculateQuickGrade(assignment.questions.filter((question) => question.type !== "LONG_ANSWER"), new Map(answers.map((answer) => [answer.questionId, answer.textValue])));
    const outcome = await prisma.$transaction(async (tx) => {
      if (isManual) {
        await tx.answer.updateMany({ where: { submissionId: submission.id, question: { type: { not: "LONG_ANSWER" } } }, data: { earnedPoints: null } });
        for (const [questionId, points] of grade.perQuestion) await tx.answer.updateMany({ where: { submissionId: submission.id, questionId }, data: { earnedPoints: points } });
        const maxPoints = assignment.questions.reduce((sum, question) => sum + question.points, 0);
        await tx.submission.update({ where: { id: submission.id }, data: { status: "SUBMITTED", submittedAt: new Date(), earnedPoints: grade.earnedPoints, maxPoints } });
        return { ok: true, status: "На проверке", grade: null, reward: null };
      }
      for (const question of assignment.questions) {
        await tx.answer.upsert({ where: { submissionId_questionId: { submissionId: submission.id, questionId: question.id } }, create: { submissionId: submission.id, questionId: question.id, textValue: "", earnedPoints: 0 }, update: { earnedPoints: grade.perQuestion.get(question.id) ?? 0 } });
      }
      const fresh = await tx.submission.update({ where: { id: submission.id }, data: { status: "COMPLETED", submittedAt: new Date(), checkedAt: new Date(), grade: grade.grade, earnedPoints: grade.earnedPoints, maxPoints: grade.maxPoints } });
      const granted = await grantReward(tx, fresh.id);
      return { ok: true, status: "Проверено автоматически", grade: grade.grade, earnedPoints: grade.earnedPoints, maxPoints: grade.maxPoints, reward: granted };
    });
    if (outcome.status === "Проверено автоматически") {
      const taskLink = `${process.env.PUBLIC_APP_URL ?? "http://127.0.0.1:5173"}/tasks/${assignment.id}`;
      await notifyEvent({ userId: context.user.id, eventKey: `task:checked:${submission.id}`, kind: "TASKS", title: "Работа проверена", body: `«${assignment.title}»\nПредмет: ${assignment.subject}\nОценка: ${outcome.grade}.${outcome.reward ? ` ${outcome.reward.note}.` : ""}`, link: taskLink });
      if (outcome.reward) {
        const updatedMembership = await prisma.membership.findUnique({ where: { id: context.membership.id }, select: { totalExp: true } });
        if (updatedMembership) await notifyLevelUp(context.user.id, context.membership.totalExp, updatedMembership.totalExp, submission.id, taskLink);
      }
    } else if (outcome.status === "На проверке") {
      const teacherLink = `${process.env.PUBLIC_APP_URL ?? "http://127.0.0.1:5173"}/teacher`;
      await Promise.all([
        notifyEvent({ userId: context.user.id, eventKey: `task:submitted:${submission.id}:${submission.attempt}`, kind: "TASKS", title: "Работа отправлена", body: `«${assignment.title}» ждёт проверки учителем.`, link: `${process.env.PUBLIC_APP_URL ?? "http://127.0.0.1:5173"}/tasks/${assignment.id}` }),
        notifyEvent({ userId: assignment.teacherId, eventKey: `task:review-needed:${submission.id}:${submission.attempt}`, kind: "TASKS", title: "Новая работа на проверку", body: `Ученик отправил работу «${assignment.title}».`, link: teacherLink }),
      ]);
    }
    return outcome;
  };

  app.put<{ Params: { id: string } }>("/api/tasks/:id/draft", async (request, reply) => saveHandler(request, reply, false, request.params.id));
  app.post<{ Params: { id: string } }>("/api/tasks/:id/submit", async (request, reply) => saveHandler(request, reply, true, request.params.id));

  app.post("/api/teacher/assignments", async (request, reply) => {
    const context = await requireRole(request, reply, ["TEACHER"]);
    if (!context) return;
    if (!context.membership) return reply.code(403).send({ error: "У профиля нет подтверждённого членства в школе. Попросите администратора подтвердить членство и роль учителя, затем войдите снова." });
    const parsed = assignmentInput.safeParse(request.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path ?? [];
      const field = String(path[0] ?? "");
      const questionIndex = typeof path[1] === "number" ? path[1] + 1 : null;
      const questionPrefix = questionIndex ? `Вопрос ${questionIndex}: ` : "";
      const questionField = String(path[2] ?? "");
      let error = "Проверьте поля задания и исправьте указанную проблему.";
      if (field === "title") error = issue?.code === "too_big" ? "Название длиннее 120 символов. Сократите его до 120 символов." : "Поле «Название» пустое. Введите название работы от 1 до 120 символов.";
      else if (field === "subject") error = issue?.code === "too_big" ? "Предмет длиннее 100 символов. Сократите его." : "Поле «Предмет» пустое. Укажите предмет от 1 до 100 символов.";
      else if (field === "description") error = issue?.code === "too_big" ? "Описание длиннее 8 000 символов. Сократите текст." : "Поле «Описание и условия» пустое. Добавьте инструкцию для ученика.";
      else if (field === "classIds") error = issue?.code === "too_big" ? "Выбрано больше 10 классов. Оставьте не более десяти." : "Класс не выбран. Выберите хотя бы один закреплённый за вами класс; если список пуст, попросите администратора назначить вас учителем класса.";
      else if (field === "questions" && questionIndex === null) error = issue?.code === "too_big" ? "В работе может быть не больше 40 вопросов. Удалите лишние." : "В работе должен быть хотя бы один вопрос. Добавьте его в конструкторе.";
      else if (field === "questions" && questionField === "prompt") error = `${questionPrefix}условие пустое или длиннее 2 000 символов. Заполните его или сократите текст.`;
      else if (field === "questions" && questionField === "points") error = `${questionPrefix}максимум баллов должен быть целым числом от 1 до 100. Исправьте значение.`;
      else if (field === "questions" && questionField === "type") error = `${questionPrefix}выберите тип вопроса из списка.`;
      else if (field === "questions" && questionField === "options") error = path.length > 3 ? `${questionPrefix}вариант ${Number(path[3]) + 1} пустой или длиннее 200 символов. Заполните его или удалите.` : issue?.code === "too_big" ? `${questionPrefix}можно указать не больше 8 вариантов ответа. Удалите лишние.` : `${questionPrefix}добавьте от 2 до 8 вариантов ответа через запятую.`;
      else if (field === "questions" && questionField === "acceptedAnswers") error = path.length > 3 ? `${questionPrefix}правильный ответ ${Number(path[3]) + 1} пустой или длиннее 100 символов. Исправьте его.` : issue?.code === "too_big" ? `${questionPrefix}можно указать не больше 20 правильных ответов. Удалите лишние.` : `${questionPrefix}заполните поле «Правильный ответ(ы)».`;
      else if (field === "questions" && questionField === "tolerance") error = `${questionPrefix}погрешность должна быть числом от 0 до 1 000 000. Исправьте значение.`;
      else if (field === "dueAt") error = "Дата в поле «Общий срок» не распознана. Выберите дату из календаря или очистите поле.";
      else if (field === "durationMinutes") error = "Время после старта должно быть целым числом от 1 до 240 минут. Исправьте значение или очистите поле.";
      else if (field === "photoFileIds") error = "К работе можно прикрепить не больше пяти фотографий. Удалите лишние файлы.";
      else if (field === "category") error = "Выберите категорию работы из списка.";
      return reply.code(400).send({ error, issues: parsed.error.issues.map((item) => item.message) });
    }
    if (parsed.data.publish && parsed.data.dueAt && new Date(parsed.data.dueAt).getTime() <= Date.now()) return reply.code(400).send({ error: "Указанный срок уже прошёл. Выберите дату и время в будущем в поле «Общий срок» или очистите поле, если срок не нужен." });
    const assignedClasses = await prisma.teacherClass.findMany({ where: { teacherId: context.membership.id, active: true, classId: { in: parsed.data.classIds }, schoolClass: { archivedAt: null, schoolId: context.membership.schoolId } }, include: { schoolClass: { include: { memberships: { where: { active: true, approved: true, role: "STUDENT" }, select: { id: true } } } } } });
    if (assignedClasses.length !== new Set(parsed.data.classIds).size || assignedClasses.some((row) => row.schoolClass.schoolId !== context.membership!.schoolId)) return reply.code(403).send({ error: "Выбранный класс не закреплён за вашим профилем учителя. Снимите его выбор или попросите администратора школы назначить вас учителем этого класса, затем повторите публикацию." });
    const maxPoints = parsed.data.questions.reduce((sum, question) => sum + question.points, 0);
    if (maxPoints <= 0) return reply.code(400).send({ error: "Сумма максимальных баллов равна нулю. Укажите каждому вопросу максимум от 1 до 100 баллов." });
    const invalidChoiceQuestion = parsed.data.questions.findIndex((question) => question.type === "SINGLE_CHOICE" && question.options.length < 2);
    if (invalidChoiceQuestion >= 0) return reply.code(400).send({ error: `Вопрос ${invalidChoiceQuestion + 1}: добавьте минимум два варианта ответа в поле «Варианты ответа · через запятую».` });
    const missingAnswerQuestion = parsed.data.questions.findIndex((question) => question.type !== "LONG_ANSWER" && question.acceptedAnswers.length === 0);
    if (missingAnswerQuestion >= 0) return reply.code(400).send({ error: `Вопрос ${missingAnswerQuestion + 1}: правильный ответ не заполнен. Введите его в поле «Правильный ответ(ы)».` });
    const photoIds = [...new Set(parsed.data.photoFileIds)];
    const assignment = await prisma.$transaction(async (tx) => {
      const photos = photoIds.length ? await tx.upload.findMany({ where: { id: { in: photoIds }, userId: context.user.id, membershipId: context.membership!.id, answerId: null, assignmentId: null, expiresAt: { gt: new Date() } }, select: { id: true } }) : [];
      if (photos.length !== photoIds.length) throw new Error("Фото отсутствует, просрочено или принадлежит другому пользователю");
      const created = await tx.assignment.create({ data: {
        schoolId: context.membership!.schoolId, teacherId: context.user.id, title: parsed.data.title, subject: parsed.data.subject, category: parsed.data.category,
        description: parsed.data.description, dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null, durationMinutes: parsed.data.durationMinutes ?? null,
        published: parsed.data.publish,
        questions: { create: parsed.data.questions.map((question, sortOrder) => ({ prompt: question.prompt, type: question.type, points: question.points, optionsJson: JSON.stringify(question.options), acceptedJson: JSON.stringify(question.acceptedAnswers), tolerance: question.tolerance, ignoreCase: question.ignoreCase, trimWhitespace: question.trimWhitespace, photoRequired: question.type === "LONG_ANSWER" && question.photoRequired, sortOrder })) },
        targets: { create: assignedClasses.map((row) => ({ classId: row.classId, recipients: { connect: row.schoolClass.memberships.map(({ id }) => ({ id })) } })) },
      }, include: { questions: true } });
      if (photoIds.length) await tx.upload.updateMany({ where: { id: { in: photoIds }, answerId: null, assignmentId: null }, data: { assignmentId: created.id, expiresAt: new Date("9999-12-31T23:59:59.999Z") } });
      return created;
    }).catch((error: unknown) => {
      if (error instanceof Error && error.message.startsWith("Фото отсутствует")) return null;
      throw error;
    });
    if (!assignment) return reply.code(400).send({ error: "Фото отсутствует, просрочено или принадлежит другому пользователю" });
    if (parsed.data.publish) {
      const memberIds = [...new Set(assignedClasses.flatMap((row) => row.schoolClass.memberships.map((member) => member.id)))];
      const recipients = memberIds.length ? await prisma.membership.findMany({ where: { id: { in: memberIds }, active: true, approved: true, role: "STUDENT" }, select: { userId: true } }) : [];
      await Promise.all(recipients.map((user) => notifyEvent({ userId: user.userId, eventKey: `task:assigned:${assignment.id}:${user.userId}`, kind: "TASKS", title: "Новое задание", body: `Предмет: ${assignment.subject}\nЗадание: ${assignment.title}${assignment.dueAt ? `\nСрок: ${assignment.dueAt.toISOString().slice(0, 16).replace("T", " ")} UTC` : ""}`, link: `${process.env.PUBLIC_APP_URL ?? "http://127.0.0.1:5173"}/tasks/${assignment.id}` })));
    }
    return reply.code(201).send({ id: assignment.id, title: assignment.title, status: parsed.data.publish ? "PUBLISHED" : "DRAFT" });
  });

  app.get("/api/teacher/assignments", async (request, reply) => {
    const context = await requireRole(request, reply, ["TEACHER"]);
    if (!context) return;
    if (!context.membership) return [];
    const rows = await prisma.assignment.findMany({ where: { teacherId: context.user.id, schoolId: context.membership.schoolId, archived: false }, include: { questions: true, uploads: true, targets: { include: { schoolClass: true, recipients: true } }, _count: { select: { submissions: true } } }, orderBy: { createdAt: "desc" } });
    return rows.map((row) => ({ id: row.id, title: row.title, subject: row.subject, category: row.category, dueAt: row.dueAt, published: row.published, archived: row.archived, photoCount: row.uploads.length, questionCount: row.questions.length, classes: row.targets.map((target) => target.schoolClass.name), recipients: row.targets.reduce((sum, target) => sum + target.recipients.length, 0), submissions: row._count.submissions }));
  });

  app.delete<{ Params: { id: string } }>("/api/teacher/assignments/:id", async (request, reply) => {
    const context = await requireRole(request, reply, ["TEACHER"]);
    if (!context) return;
    if (!context.membership) return reply.code(403).send({ error: "Нет школьной принадлежности" });
    const result = await prisma.$transaction(async (tx) => {
      const changed = await tx.assignment.updateMany({ where: { id: request.params.id, teacherId: context.user.id, schoolId: context.membership!.schoolId, archived: false }, data: { archived: true } });
      if (!changed.count) return false;
      await tx.outbox.updateMany({ where: { status: "PENDING", OR: [{ dedupeKey: { startsWith: `notification:task:assigned:${request.params.id}:` } }, { dedupeKey: { startsWith: `notification:task:reminder:${request.params.id}:` } }] }, data: { status: "SKIPPED" } });
      await tx.auditLog.create({ data: { actorId: context.user.id, schoolId: context.membership!.schoolId, action: "TEACHER_ASSIGNMENT_REMOVED", objectType: "Assignment", objectId: request.params.id } });
      return true;
    });
    if (!result) return reply.code(404).send({ error: "Задание не найдено или уже удалено" });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/api/teacher/assignments/:id/publish", async (request, reply) => {
    const context = await requireRole(request, reply, ["TEACHER"]);
    if (!context) return;
    if (!context.membership) return reply.code(403).send({ error: "Нет школьной принадлежности" });
    const assignment = await teacherAssignment(request.params.id, context.membership, context.user.id);
    if (!assignment || assignment.archived) return reply.code(404).send({ error: "Работа не найдена" });
    if (assignment.published) return { ok: true, published: true };
    if (!assignment.questions.length || assignment.questions.reduce((sum, question) => sum + question.points, 0) <= 0) return reply.code(400).send({ error: "В работе нужен хотя бы один вопрос и положительный максимум баллов" });
    const published = await prisma.assignment.update({ where: { id: assignment.id }, data: { published: true } });
    const memberIds = [...new Set(assignment.targets.flatMap((target) => target.recipients.map((recipient) => recipient.id)))];
    const users = memberIds.length ? await prisma.membership.findMany({ where: { id: { in: memberIds }, active: true, approved: true, role: "STUDENT" }, select: { userId: true } }) : [];
    await Promise.all(users.map((user) => notifyEvent({ userId: user.userId, eventKey: `task:assigned:${assignment.id}:${user.userId}`, kind: "TASKS", title: "Новое задание", body: `Предмет: ${assignment.subject}\nЗадание: ${assignment.title}${assignment.dueAt ? `\nСрок: ${assignment.dueAt.toISOString().slice(0, 16).replace("T", " ")} UTC` : ""}`, link: `${process.env.PUBLIC_APP_URL ?? "http://127.0.0.1:5173"}/tasks/${assignment.id}` })));
    return { ok: true, published: published.published };
  });

  app.get("/api/teacher/submissions", async (request, reply) => {
    const context = await requireRole(request, reply, ["TEACHER"]);
    if (!context) return;
    if (!context.membership) return [];
    const rows = await prisma.submission.findMany({
      where: { status: { in: ["SUBMITTED", "RETURNED", "COMPLETED"] }, assignment: { schoolId: context.membership.schoolId, teacherId: context.user.id } },
      include: { assignment: { select: { id: true, title: true, subject: true, category: true } }, membership: { include: { user: { select: { id: true, displayName: true, firstName: true, lastName: true, username: true } }, schoolClass: { select: { name: true } } } }, answers: { include: { question: { select: { id: true, prompt: true, type: true, points: true } }, uploads: { select: { id: true, mimeType: true } } } } },
      orderBy: { submittedAt: "asc" },
    });
    return rows.map((row) => ({ id: row.id, status: row.status, assignment: row.assignment, student: { id: row.membership.user.id, name: displayUserName(row.membership.user), className: row.membership.schoolClass?.name ?? "" }, submittedAt: row.submittedAt, grade: row.grade, earnedPoints: row.earnedPoints, maxPoints: row.maxPoints, teacherComment: row.teacherComment, answers: row.answers.map((answer) => ({ question: answer.question, text: answer.textValue, earnedPoints: answer.earnedPoints, uploads: answer.uploads.map((file) => ({ id: file.id, url: `/api/files/${file.id}` })) })) }));
  });

  app.post<{ Params: { id: string } }>("/api/teacher/submissions/:id/review", async (request, reply) => {
    const context = await requireRole(request, reply, ["TEACHER"]);
    if (!context) return;
    if (!context.membership) return reply.code(403).send({ error: "Нет школьной принадлежности" });
    const bodySchema = z.object({ action: z.enum(["complete", "return"]), scores: z.record(z.string(), z.number().int().min(0).max(100)).default({}), comment: z.string().max(2000).optional(), extendedDueAt: z.string().datetime().optional() });
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Проверьте баллы и комментарий" });
    const submission = await prisma.submission.findUnique({ where: { id: request.params.id }, include: { assignment: { include: { questions: true, targets: true } }, answers: true, membership: { select: { userId: true } } } });
    if (!submission || !["SUBMITTED", "RETURNED"].includes(submission.status)) return reply.code(404).send({ error: "Сдача не найдена или уже закрыта" });
    if (!(await teacherAssignment(submission.assignmentId, context.membership, context.user.id, true))) return reply.code(403).send({ error: "Эта работа не закреплена за вами" });
    if (parsed.data.action === "return") {
      if (!parsed.data.comment?.trim()) return reply.code(400).send({ error: "При возврате на доработку добавьте понятный комментарий" });
      const pastDue = submission.assignment.dueAt && submission.assignment.dueAt < new Date();
      if (pastDue && !parsed.data.extendedDueAt) return reply.code(400).send({ error: "Укажите новый срок доработки" });
      await prisma.submission.update({ where: { id: submission.id }, data: { status: "RETURNED", teacherComment: parsed.data.comment, ...(parsed.data.extendedDueAt ? { extendedDueAt: new Date(parsed.data.extendedDueAt) } : {}) } });
      await notifyEvent({ userId: submission.membership.userId, eventKey: `task:returned:${submission.id}:${submission.attempt}`, kind: "TASKS", title: "Работу вернули на доработку", body: `«${submission.assignment.title}». Комментарий: ${parsed.data.comment}`, link: `${process.env.PUBLIC_APP_URL ?? "http://127.0.0.1:5173"}/tasks/${submission.assignmentId}` });
      return { ok: true, status: "RETURNED" };
    }
    const total = submission.assignment.questions.reduce((sum, question) => sum + question.points, 0);
    if (total <= 0) return reply.code(400).send({ error: "У работы не задан максимум баллов" });
    for (const question of submission.assignment.questions) {
      const score = parsed.data.scores[question.id] ?? 0;
      if (score > question.points) return reply.code(400).send({ error: `Для вопроса «${question.prompt}» максимум — ${question.points}` });
    }
    const earned = submission.assignment.questions.reduce((sum, question) => sum + (parsed.data.scores[question.id] ?? 0), 0);
    const beforeExp = (await prisma.membership.findUnique({ where: { id: submission.membershipId }, select: { totalExp: true } }))?.totalExp ?? 0;
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.submission.updateMany({ where: { id: submission.id, rewardGranted: false, status: { in: ["SUBMITTED", "RETURNED"] } }, data: { status: "COMPLETED", grade: gradeFromPercent(earned / total * 100), earnedPoints: earned, maxPoints: total, teacherComment: parsed.data.comment ?? null, checkedAt: new Date() } });
      if (updated.count !== 1) throw new Error("Эта сдача уже проверена другим запросом");
      for (const question of submission.assignment.questions) await tx.answer.updateMany({ where: { submissionId: submission.id, questionId: question.id }, data: { earnedPoints: parsed.data.scores[question.id] ?? 0 } });
      const granted = await grantReward(tx, submission.id);
      return { ok: true, grade: gradeFromPercent(earned / total * 100), earnedPoints: earned, maxPoints: total, rewardGranted: Boolean(granted), reward: granted };
    });
    await notifyEvent({ userId: submission.membership.userId, eventKey: `task:checked:${submission.id}`, kind: "TASKS", title: "Работа проверена", body: `«${submission.assignment.title}»\nПредмет: ${submission.assignment.subject}\nОценка: ${result.grade}.${result.reward ? ` ${result.reward.note}.` : ""}`, link: `${process.env.PUBLIC_APP_URL ?? "http://127.0.0.1:5173"}/tasks/${submission.assignmentId}` });
    if (result.rewardGranted) {
      const afterExp = await prisma.membership.findUnique({ where: { id: submission.membershipId }, select: { totalExp: true } });
      if (afterExp) await notifyLevelUp(submission.membership.userId, beforeExp, afterExp.totalExp, submission.id, `${process.env.PUBLIC_APP_URL ?? "http://127.0.0.1:5173"}/tasks/${submission.assignmentId}`);
    }
    return result;
  });

  app.get("/api/teacher/stats", async (request, reply) => {
    const context = await requireRole(request, reply, ["TEACHER"]);
    if (!context) return;
    if (!context.membership) return { assignments: 0, submissions: 0, pending: 0, completion: { done: 0, total: 0 }, grades: { 2: 0, 3: 0, 4: 0, 5: 0 } };
    const assignments = await prisma.assignment.findMany({ where: { teacherId: context.user.id, schoolId: context.membership.schoolId }, include: { _count: { select: { submissions: true } }, submissions: { select: { status: true, grade: true } } } });
    const all = assignments.flatMap((assignment) => assignment.submissions);
    const grades = { 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const row of all) if (row.status === "COMPLETED" && row.grade) grades[row.grade as 2 | 3 | 4 | 5] += 1;
      const totalRecipients = await prisma.assignmentTarget.findMany({ where: { assignment: { teacherId: context.user.id }, classId: { in: (await prisma.teacherClass.findMany({ where: { teacherId: context.membership.id, active: true, schoolClass: { archivedAt: null } }, select: { classId: true } })).map((row) => row.classId) } }, include: { _count: { select: { recipients: true } } } });
    const total = totalRecipients.reduce((sum, target) => sum + target._count.recipients, 0);
    return { assignments: assignments.length, submissions: all.length, pending: all.filter((row) => row.status === "SUBMITTED").length, completion: { done: all.filter((row) => row.status === "COMPLETED").length, total }, grades };
  });
}

export async function autoSubmitExpired() {
  const active = await prisma.submission.findMany({ where: { status: "IN_PROGRESS", startedAt: { not: null }, assignment: { archived: false } }, include: { assignment: { include: { questions: true } }, answers: true, membership: { include: { school: true } } } });
  const now = new Date();
  for (const submission of active) {
    const deadlines: Date[] = [];
    if (submission.extendedDueAt) deadlines.push(submission.extendedDueAt);
    else if (submission.assignment.dueAt) deadlines.push(submission.assignment.dueAt);
    if (submission.assignment.durationMinutes && submission.startedAt) deadlines.push(new Date(submission.startedAt.getTime() + submission.assignment.durationMinutes * 60_000));
    const deadline = deadlines.length ? new Date(Math.min(...deadlines.map((item) => item.getTime()))) : null;
    if (!deadline || deadline > now) continue;
    const filled = submission.answers.some((answer) => answer.textValue.trim());
    if (!filled) {
      await prisma.submission.updateMany({ where: { id: submission.id, status: "IN_PROGRESS", assignment: { archived: false } }, data: { status: "EXPIRED", submittedAt: now } });
      continue;
    }
    await prisma.$transaction(async (tx) => {
      const complete = submission.assignment.questions.every((question) => question.type !== "LONG_ANSWER");
      if (!complete) {
        await tx.submission.updateMany({ where: { id: submission.id, status: "IN_PROGRESS", assignment: { archived: false } }, data: { status: "SUBMITTED", submittedAt: now } });
      } else {
        const result = calculateQuickGrade(submission.assignment.questions, new Map(submission.answers.map((answer) => [answer.questionId, answer.textValue])));
        const updated = await tx.submission.updateMany({ where: { id: submission.id, status: "IN_PROGRESS", assignment: { archived: false } }, data: { status: "COMPLETED", submittedAt: now, checkedAt: now, grade: result.grade, earnedPoints: result.earnedPoints, maxPoints: result.maxPoints } });
        if (updated.count) await grantReward(tx, submission.id);
      }
    });
  }
}

export async function sendDueReminders() {
  const now = new Date();
  const assignments = await prisma.assignment.findMany({ where: { published: true, archived: false, dueAt: { gt: now, lte: new Date(now.getTime() + 24 * 60 * 60_000) } }, include: { targets: { include: { recipients: { where: { active: true, approved: true, role: "STUDENT" }, select: { id: true, userId: true } } } } } });
  for (const assignment of assignments) {
    for (const target of assignment.targets) {
      for (const recipient of target.recipients) {
        const existing = await prisma.submission.findFirst({ where: { assignmentId: assignment.id, membershipId: recipient.id, status: { in: ["IN_PROGRESS", "SUBMITTED", "COMPLETED"] } }, select: { id: true } });
        if (existing) continue;
        await notifyEvent({ userId: recipient.userId, eventKey: `task:reminder:${assignment.id}:${recipient.userId}`, kind: "TASKS", title: "Скоро срок задания", body: `До срока «${assignment.title}» осталось меньше суток.`, link: `${process.env.PUBLIC_APP_URL ?? "http://127.0.0.1:5173"}/tasks/${assignment.id}` });
      }
    }
  }
}
