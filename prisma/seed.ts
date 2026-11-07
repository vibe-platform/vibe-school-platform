import "dotenv/config";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { type CosmeticType, type QuestionType, type Role } from "@prisma/client";
import { rewardForGradeAndStreak, rewardPolicyVersion, levelForExp, mondayWeekKey } from "../packages/shared/src/index.js";
import { prisma } from "../apps/api/src/db.js";
import { cosmetics } from "./cosmetics.js";

type DemoPerson = { key: string; maxId: string; first: string; last: string; className?: string; role: Role; exp?: number; school?: "main" | "other" };

const people: DemoPerson[] = [
  { key: "student-new", maxId: "910000000000001", first: "Аня", last: "Смирнова", className: "7А", role: "STUDENT", exp: 0, school: "main" },
  { key: "student-7exp", maxId: "910000000000002", first: "Никита", last: "Орлов", className: "8Б", role: "STUDENT", exp: 7, school: "main" },
  { key: "student-24exp", maxId: "910000000000003", first: "Мария", last: "Соколова", className: "8Б", role: "STUDENT", exp: 24, school: "main" },
  { key: "student-99exp", maxId: "910000000000004", first: "Артём", last: "Волков", className: "9А", role: "STUDENT", exp: 99, school: "main" },
  ...[
    ["Лиза", "Кузнецова", "7А"], ["Даниил", "Попов", "7А"], ["София", "Лебедева", "7А"],
    ["Марк", "Новиков", "8Б"], ["Вера", "Морозова", "8Б"], ["Тимур", "Петров", "8Б"],
    ["Кира", "Васильева", "9А"], ["Матвей", "Семёнов", "9А"],
  ].map(([first, last, className], index) => ({ key: `student-${index + 5}`, maxId: `9100000000000${String(index + 5).padStart(2, "0")}`, first: first!, last: last!, className: className!, role: "STUDENT" as const, exp: 0, school: "main" as const })),
  { key: "teacher-1", maxId: "920000000000001", first: "Елена", last: "Лебедева", role: "TEACHER", school: "main" },
  { key: "teacher-2", maxId: "920000000000002", first: "Павел", last: "Морозов", role: "TEACHER", school: "main" },
  { key: "school-admin", maxId: "930000000000001", first: "Дарья", last: "Белова", role: "SCHOOL_ADMIN", school: "main" },
  { key: "owner", maxId: "940000000000001", first: "Ирина", last: "Вайб", role: "PROJECT_OWNER" },
  { key: "other-student", maxId: "950000000000001", first: "Олег", last: "Фёдоров", className: "6А", role: "STUDENT", exp: 0, school: "other" },
  { key: "other-teacher", maxId: "950000000000002", first: "Нина", last: "Громова", role: "TEACHER", school: "other" },
  { key: "other-admin", maxId: "950000000000003", first: "Роман", last: "Зайцев", role: "SCHOOL_ADMIN", school: "other" },
];

const questionData = (prompt: string, type: QuestionType, accepted: string[], points = 1, options: string[] = []) => ({
  prompt, type, points, optionsJson: JSON.stringify(options), acceptedJson: JSON.stringify(accepted),
  tolerance: 0, ignoreCase: true, trimWhitespace: true, photoRequired: type === "LONG_ANSWER", sortOrder: 0,
});

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl?.startsWith("file:")) throw new Error("The standard seed only supports a local SQLite database.");
  const databasePathRaw = decodeURIComponent(databaseUrl.slice("file:".length).split("?")[0]!);
  const databasePath = path.resolve(path.isAbsolute(databasePathRaw) ? databasePathRaw : path.resolve(process.cwd(), "prisma", databasePathRaw));
  const dataRoot = path.resolve(process.cwd(), "data");
  const relativeDatabasePath = path.relative(dataRoot, databasePath);
  const isE2eDatabase = relativeDatabasePath.startsWith(`e2e-runs${path.sep}`);
  const isMainDatabase = relativeDatabasePath === `vibe.db`;
  if (!isE2eDatabase && !isMainDatabase) throw new Error(`The standard seed is limited to an empty data/vibe.db or a disposable data/e2e-runs database (received ${databasePath}).`);
  if (isMainDatabase && await prisma.user.count() > 0) throw new Error("The standard seed only initializes an empty main database. Existing accounts, progress, and role assignments were left untouched.");
  const school = await prisma.school.upsert({ where: { name_city: { name: "Школа Вайб № 21", city: "Казань" } }, create: { name: "Школа Вайб № 21", city: "Казань", timezone: "Europe/Moscow" }, update: {} });
  const otherSchool = await prisma.school.upsert({ where: { name_city: { name: "Школа Вайб № 4", city: "Казань" } }, create: { name: "Школа Вайб № 4", city: "Казань", timezone: "Europe/Moscow" }, update: {} });
  const classes = new Map<string, string>();
  for (const [schoolId, names] of [[school.id, ["7А", "8Б", "9А"]], [otherSchool.id, ["6А"]]] as const) {
    for (const name of names) {
      const normalizedName = name.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleUpperCase("ru-RU");
      const row = await prisma.schoolClass.upsert({ where: { schoolId_normalizedName: { schoolId, normalizedName } }, create: { schoolId, name, normalizedName }, update: {} });
      classes.set(`${schoolId}:${name}`, row.id);
    }
  }

  const userByKey = new Map<string, { id: string; membershipId?: string; schoolId?: string; classId?: string }>();
  const membershipByKey = new Map<string, string>();
  for (const person of people) {
    const user = await prisma.user.upsert({
      where: { maxUserId: person.maxId },
      create: { maxUserId: person.maxId, firstName: person.first, lastName: person.last, username: person.key, ...(person.role === "PROJECT_OWNER" ? { platformRole: "PROJECT_OWNER" as const } : {}) },
      update: person.role === "PROJECT_OWNER" ? { platformRole: "PROJECT_OWNER" } : {},
    });
    userByKey.set(person.key, { id: user.id });
    await prisma.profileAppearance.upsert({ where: { userId: user.id }, create: { userId: user.id, emoji: "emoji-none", frame: "frame-none", title: "title-none", pattern: "pattern-none" }, update: {} });
    await prisma.userPreferences.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} });
    if (person.school) {
      const chosenSchool = person.school === "main" ? school : otherSchool;
      const classId = person.className ? classes.get(`${chosenSchool.id}:${person.className}`) : undefined;
      const role: Role = person.role === "PROJECT_OWNER" ? "STUDENT" : person.role;
      const membership = await prisma.membership.upsert({
        where: { userId_schoolId: { userId: user.id, schoolId: chosenSchool.id } },
        create: { userId: user.id, schoolId: chosenSchool.id, ...(classId ? { classId } : {}), role, isTeacher: role === "TEACHER", isSchoolAdmin: role === "SCHOOL_ADMIN" },
        update: {},
      });
      userByKey.set(person.key, { id: user.id, membershipId: membership.id, schoolId: chosenSchool.id, classId });
      membershipByKey.set(person.key, membership.id);
    }
  }

  for (const person of people.filter((row) => row.role === "TEACHER")) {
    const personRecord = userByKey.get(person.key)!;
    const membershipId = membershipByKey.get(person.key)!;
    const classNames = person.key === "teacher-1" ? ["7А", "8Б"] : person.key === "teacher-2" ? ["9А"] : ["6А"];
    for (const className of classNames) {
      const classId = classes.get(`${person.school === "other" ? otherSchool.id : school.id}:${className}`)!;
      await prisma.teacherClass.upsert({ where: { teacherId_classId: { teacherId: membershipId, classId } }, create: { teacherId: membershipId, classId }, update: {} });
    }
    void personRecord;
  }

  const catalog = new Map<string, { id: string; unlockLevel: number; type: CosmeticType }>();
  for (const item of cosmetics) {
    const saved = await prisma.cosmeticItem.upsert({
      where: { slug: item.slug },
      create: { slug: item.slug, type: item.type, unlockLevel: item.level, displayName: item.name, assetKey: item.asset, value: item.value, groupKey: item.group },
      update: { type: item.type, unlockLevel: item.level, displayName: item.name, assetKey: item.asset, value: item.value, groupKey: item.group },
    });
    catalog.set(item.slug, { id: saved.id, unlockLevel: saved.unlockLevel, type: saved.type });
  }
  for (const person of people) {
    const user = userByKey.get(person.key)!;
    const exp = person.exp ?? 0;
    const level = levelForExp(exp);
    const eligible = [...catalog.entries()].filter(([, entry]) => entry.unlockLevel <= level).map(([, entry]) => ({ userId: user.id, cosmeticId: entry.id, source: "SEED_PROGRESS" }));
    if (eligible.length) {
      const existing = await prisma.cosmeticUnlock.findMany({ where: { userId: user.id, cosmeticId: { in: eligible.map((item) => item.cosmeticId) } }, select: { cosmeticId: true } });
      const existingIds = new Set(existing.map((row) => row.cosmeticId));
      const missing = eligible.filter((item) => !existingIds.has(item.cosmeticId));
      if (missing.length) await prisma.cosmeticUnlock.createMany({ data: missing });
    }
  }

  const teacher1Id = userByKey.get("teacher-1")!.id;
  const teacher2Id = userByKey.get("teacher-2")!.id;
  const now = new Date();
  const daysFromNow = (amount: number) => new Date(now.getTime() + amount * 86_400_000);
  const assignmentSeeds = [
    { key: "quick-fractions", title: "Короткая разминка: дроби", subject: "Математика", category: "Учёба", description: "Реши два коротких примера и проверь себя.", due: 10, duration: 15, teacher: teacher1Id, classes: ["7А", "8Б"], questions: [questionData("Сколько будет 1/2 + 1/2?", "NUMBER", ["1"]), questionData("Сколько будет 8 × 7?", "NUMBER", ["56"])] },
    { key: "creative-poster", title: "Плакат добрых слов", subject: "Творчество", category: "Творчество", description: "Нарисуй плакат, который поддержит одноклассников. Добавь фото работы.", due: 4, duration: null, teacher: teacher1Id, classes: ["7А", "8Б"], questions: [questionData("Расскажи, какую идею ты хотел(а) передать.", "LONG_ANSWER", [], 5)] },
    { key: "mixed-forest", title: "Исследуем школьный двор", subject: "Окружающий мир", category: "Школьная жизнь", description: "Ответь на вопрос и приложи фото или рисунок наблюдения.", due: 5, duration: null, teacher: teacher1Id, classes: ["7А", "8Б", "9А"], questions: [questionData("Сколько разных видов растений ты заметил(а)?", "NUMBER", ["3"], 2), questionData("Приложи фото или опиши одно наблюдение.", "LONG_ANSWER", [], 3)] },
    { key: "sport-move", title: "Моя активная пауза", subject: "Физкультура", category: "Спорт", description: "Выбери безопасную разминку и расскажи, что помогло почувствовать себя бодрее.", due: 12, duration: null, teacher: teacher2Id, classes: ["9А"], questions: [questionData("Опиши разминку в нескольких предложениях.", "LONG_ANSWER", [], 5)] },
    { key: "volunteer-library", title: "Помощь школьной библиотеке", subject: "Внеурочная деятельность", category: "Волонтёрство", description: "Помоги библиотеке или предложи полезное дело и коротко опиши результат.", due: 7, duration: null, teacher: teacher2Id, classes: ["9А"], questions: [questionData("Что ты сделал(а) и кому это помогло?", "LONG_ANSWER", [], 5)] },
    { key: "quick-history", title: "Исторический блиц", subject: "История", category: "Учёба", description: "Ответь на вопрос с выбором одного варианта.", due: -2, duration: 10, teacher: teacher1Id, classes: ["7А", "8Б"], questions: [questionData("В каком городе находится Казанский кремль?", "SINGLE_CHOICE", ["Казань"], 1, ["Казань", "Самара", "Томск"])] },
    { key: "quick-reading", title: "Читаем и замечаем", subject: "Литература", category: "Учёба", description: "Прочитай короткий отрывок и назови настроение героя.", due: 3, duration: 20, teacher: teacher1Id, classes: ["7А", "8Б"], questions: [questionData("Выбери настроение героя.", "SINGLE_CHOICE", ["Спокойное"], 1, ["Спокойное", "Сердитое", "Испуганное"])] },
    { key: "class-garden", title: "Идея для зелёного класса", subject: "Проектная работа", category: "Школьная жизнь", description: "Предложи небольшое улучшение класса и объясни, как его реализовать.", due: 14, duration: null, teacher: teacher2Id, classes: ["9А"], questions: [questionData("Какую идею ты предлагаешь?", "LONG_ANSWER", [], 5)] },
  ];

  const assignedStudents = new Map<string, string[]>();
  for (const person of people.filter((row) => row.role === "STUDENT" && row.className)) {
    const data = userByKey.get(person.key)!;
    const entries = assignedStudents.get(data.classId!) ?? [];
    entries.push(data.membershipId!);
    assignedStudents.set(data.classId!, entries);
  }

  const assignments = new Map<string, { id: string; questions: Array<{ id: string; type: QuestionType; prompt: string }> }>();
  for (const item of assignmentSeeds) {
    const schoolId = item.teacher === teacher1Id ? school.id : school.id;
    let assignment = await prisma.assignment.findUnique({ where: { seedKey: item.key }, include: { questions: true } });
    if (!assignment) {
      assignment = await prisma.assignment.create({ data: {
        seedKey: item.key, schoolId, teacherId: item.teacher, title: item.title, subject: item.subject, category: item.category,
        description: item.description, dueAt: daysFromNow(item.due), durationMinutes: item.duration, published: true,
        questions: { create: item.questions },
      }, include: { questions: true } });
    }
    for (const className of item.classes) {
      const classId = classes.get(`${school.id}:${className}`)!;
      await prisma.assignmentTarget.upsert({
        where: { assignmentId_classId: { assignmentId: assignment.id, classId } },
        create: { assignmentId: assignment.id, classId, recipients: { connect: (assignedStudents.get(classId) ?? []).map((id) => ({ id })) } },
        update: {},
      });
    }
    assignments.set(item.key, { id: assignment.id, questions: assignment.questions.map(({ id, type, prompt }) => ({ id, type, prompt })) });
  }

                                                                                      
  const historyUsers = people.filter((row) => row.exp && row.exp > 0);
  for (const person of historyUsers) {
    const info = userByKey.get(person.key)!;
    const membershipId = info.membershipId!;
    const historyCount = person.exp!;
    for (let i = 0; i < historyCount; i += 1) {
      const key = `history:${person.key}:${i + 1}`;
      let assignment = await prisma.assignment.findUnique({ where: { seedKey: key }, include: { questions: true } });
      if (!assignment) {
        const createdAt = daysFromNow(i - historyCount - 1);
        assignment = await prisma.assignment.create({ data: {
          seedKey: key, schoolId: info.schoolId!, teacherId: person.key === "student-99exp" ? teacher2Id : teacher1Id,
          title: `Архивная работа ${i + 1}`, subject: ["Математика", "Литература", "Проектная деятельность"][i % 3]!,
          category: ["Учёба", "Творчество", "Спорт", "Волонтёрство"][i % 4]!, description: "Завершённая синтетическая демо-работа.",
          published: false, archived: true, dueAt: createdAt,
          questions: { create: questionData("Демо-ответ", "SHORT_TEXT", ["готово"]) },
        }, include: { questions: true } });
      }
      const question = assignment.questions[0]!;
      const submittedAt = daysFromNow(i - historyCount - 1);
      const submission = await prisma.submission.upsert({
        where: { assignmentId_membershipId_attempt: { assignmentId: assignment.id, membershipId, attempt: 1 } },
        create: { assignmentId: assignment.id, membershipId, status: "COMPLETED", startedAt: submittedAt, submittedAt, checkedAt: submittedAt, grade: [3, 4, 5][i % 3]!, earnedPoints: [1, 2, 3][i % 3]!, maxPoints: 3, rewardGranted: true },
        update: {},
      });
      await prisma.answer.upsert({ where: { submissionId_questionId: { submissionId: submission.id, questionId: question.id } }, create: { submissionId: submission.id, questionId: question.id, textValue: "готово", earnedPoints: 1 }, update: {} });
      const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).format(submittedAt);
      await prisma.activityDay.upsert({ where: { membershipId_dayKey: { membershipId, dayKey } }, create: { membershipId, dayKey }, update: {} });
      const grade = [3, 4, 5][i % 3]!;
      const reward = rewardForGradeAndStreak(grade, i + 1)!;
      let current = await prisma.membership.findUniqueOrThrow({ where: { id: membershipId } });
      const baseKey = `task:${submission.id}`;
      if (!(await prisma.ledgerEntry.findUnique({ where: { idempotencyKey: baseKey } }))) {
        const amountText = `${reward.baseReward} × ${(reward.multiplierTenths / 10).toLocaleString("ru-RU")} = ${reward.einsteins}`;
        current = await prisma.membership.update({ where: { id: membershipId }, data: { balance: { increment: reward.einsteins }, totalExp: { increment: 1 } } });
        await prisma.ledgerEntry.create({ data: {
          membershipId, kind: "TASK_REWARD", amount: reward.einsteins, expAmount: 1, balanceAfter: current.balance, totalExpAfter: current.totalExp,
          referenceId: submission.id, idempotencyKey: baseKey, rewardScopeKey: `task:${membershipId}:${assignment.id}`,
          rewardPolicyVersion, rewardGradeSnapshot: grade, rewardBaseAmount: reward.baseReward, rewardDayKey: dayKey,
          rewardMultiplierTenths: reward.multiplierTenths, rewardTargetAmount: reward.einsteins,
          note: `Оценка ${grade}: ${amountText} Эйнштейнов; +1 EXP`,
        } });
      }
    }
  }

  const sampleUser = userByKey.get("student-new")!;
  const sampleMembership = sampleUser.membershipId!;
  const waitingAssignment = assignments.get("mixed-forest")!;
  const waiting = await prisma.submission.upsert({
    where: { assignmentId_membershipId_attempt: { assignmentId: waitingAssignment.id, membershipId: sampleMembership, attempt: 1 } },
    create: { assignmentId: waitingAssignment.id, membershipId: sampleMembership, status: "SUBMITTED", submittedAt: new Date(), maxPoints: 5 },
    update: {},
  });
  for (const q of waitingAssignment.questions) {
    await prisma.answer.upsert({ where: { submissionId_questionId: { submissionId: waiting.id, questionId: q.id } }, create: { submissionId: waiting.id, questionId: q.id, textValue: "Наблюдал(а) за школьным двором." }, update: {} });
  }

  const otherUser = userByKey.get("other-student")!;
  const otherMembership = otherUser.membershipId!;
  let overdueAssignment = await prisma.assignment.findUnique({ where: { seedKey: "other-school-quick" }, include: { questions: true } });
  if (!overdueAssignment) {
    overdueAssignment = await prisma.assignment.create({ data: {
      seedKey: "other-school-quick", schoolId: otherSchool.id, teacherId: userByKey.get("other-teacher")!.id,
      title: "Исторический блиц школы 4", subject: "История", category: "Учёба", description: "Локальная работа второй школы.",
      dueAt: daysFromNow(-2), published: true,
      questions: { create: questionData("В каком городе находится Казанский кремль?", "SINGLE_CHOICE", ["Казань"], 1, ["Казань", "Самара", "Томск"]) },
    }, include: { questions: true } });
  }
  const otherClassId = classes.get(`${otherSchool.id}:6А`)!;
  await prisma.assignmentTarget.upsert({
    where: { assignmentId_classId: { assignmentId: overdueAssignment.id, classId: otherClassId } },
    create: { assignmentId: overdueAssignment.id, classId: otherClassId, recipients: { connect: [{ id: otherMembership }] } },
    update: {},
  });
  const overdue = await prisma.submission.upsert({
    where: { assignmentId_membershipId_attempt: { assignmentId: overdueAssignment.id, membershipId: otherMembership, attempt: 1 } },
    create: { assignmentId: overdueAssignment.id, membershipId: otherMembership, status: "COMPLETED", startedAt: daysFromNow(-4), submittedAt: daysFromNow(-4), checkedAt: daysFromNow(-4), grade: 4, earnedPoints: 1, maxPoints: 1, rewardGranted: true },
    update: {},
  });
  await prisma.answer.upsert({ where: { submissionId_questionId: { submissionId: overdue.id, questionId: overdueAssignment.questions[0]!.id } }, create: { submissionId: overdue.id, questionId: overdueAssignment.questions[0]!.id, textValue: "Казань", earnedPoints: 1 }, update: {} });

  const looks = [
    { key: "student-new", background: "pearl", emoji: "emoji-none", frame: "frame-none", title: "title-none", pattern: "pattern-none" },
    { key: "student-7exp", background: "pearl", emoji: "spark-2", frame: "frame-none", title: "title-none", pattern: "pattern-none" },
    { key: "student-24exp", background: "bg-lavender", emoji: "spark-6", frame: "frame-thin-glass", title: "title-3", pattern: "pattern-none" },
    { key: "student-99exp", background: "bg-cosmic-mist", emoji: "emoji-satellite", frame: "frame-rings", title: "title-traveler", pattern: "pattern-stardust" },
  ];
  for (const look of looks) {
    const user = userByKey.get(look.key)!;
    await prisma.profileAppearance.upsert({ where: { userId: user.id }, create: { userId: user.id, background: look.background, emoji: look.emoji, frame: look.frame, title: look.title, pattern: look.pattern }, update: {} });
  }

  const products = [
    { slug: "vibe-stickers", scope: "GLOBAL" as const, name: "Набор стикеров «Маленькие радости»", description: "Набор авторских бумажных стикеров для тетрадей.", category: "Стикеры", imageKey: "stickers", price: 25, stock: 40, perUserLimit: 2 },
    { slug: "vibe-badge", scope: "GLOBAL" as const, name: "Значок Вайб", description: "Небольшой значок для рюкзака.", category: "Значки", imageKey: "badge", price: 55, stock: 18, perUserLimit: 1 },
    { slug: "school-music-break", scope: "SCHOOL" as const, schoolId: school.id, name: "Музыка для перемены", description: "Предложи композицию и обсуди её с классным руководителем.", category: "Школьная жизнь", imageKey: "music", price: 60, stock: 6, perUserLimit: 1 },
    { slug: "school-library", scope: "SCHOOL" as const, schoolId: school.id, name: "Билет в книжный уголок", description: "Выбери книгу из подборки школьной библиотеки.", category: "Книги", imageKey: "book", price: 90, stock: 4, perUserLimit: 1 },
    { slug: "other-reward", scope: "SCHOOL" as const, schoolId: otherSchool.id, name: "Выбор доброго дела", description: "Личная награда другой школы.", category: "Школьная жизнь", imageKey: "leaf", price: 20, stock: 3, perUserLimit: 1 },
  ];
  const productBySlug = new Map<string, string>();
  for (const product of products) {
    const saved = await prisma.product.upsert({ where: { slug: product.slug }, create: product, update: {} });
    productBySlug.set(product.slug, saved.id);
  }
  const favoriteMembership = userByKey.get("student-24exp")!.membershipId!;
  for (const slug of ["vibe-stickers", "school-music-break"]) {
    await prisma.favoriteProduct.upsert({ where: { membershipId_productId: { membershipId: favoriteMembership, productId: productBySlug.get(slug)! } }, create: { membershipId: favoriteMembership, productId: productBySlug.get(slug)! }, update: {} });
  }
  await prisma.savingsGoal.upsert({ where: { membershipId: favoriteMembership }, create: { membershipId: favoriteMembership, productId: productBySlug.get("vibe-badge")! }, update: {} });
  const weekStart = mondayWeekKey(now, "Europe/Moscow");
  const goalOwner = userByKey.get("student-new")!.membershipId!;
  await prisma.weeklyGoal.upsert({ where: { membershipId_weekStart: { membershipId: goalOwner, weekStart } }, create: { membershipId: goalOwner, weekStart, target: 2 }, update: {} });
  await prisma.weeklyGoal.upsert({ where: { membershipId_weekStart: { membershipId: favoriteMembership, weekStart } }, create: { membershipId: favoriteMembership, weekStart, target: 3 }, update: {} });
  const seedOrderKey = `seed-order:${favoriteMembership}:stickers`;
  if (!(await prisma.order.findUnique({ where: { idempotencyKey: seedOrderKey } }))) {
    const productId = productBySlug.get("vibe-stickers")!;
    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    const membership = await prisma.membership.findUniqueOrThrow({ where: { id: favoriteMembership } });
    if (membership.balance >= product.price && product.stock > 0) {
      await prisma.$transaction(async (tx) => {
        await tx.product.update({ where: { id: productId }, data: { stock: { decrement: 1 } } });
        const after = await tx.membership.update({ where: { id: favoriteMembership }, data: { balance: { decrement: product.price } } });
        await tx.ledgerEntry.create({ data: { membershipId: favoriteMembership, kind: "PURCHASE", amount: -product.price, balanceAfter: after.balance, totalExpAfter: after.totalExp, referenceId: seedOrderKey, idempotencyKey: `purchase:${seedOrderKey}`, note: "Демо-заказ набора стикеров" } });
        await tx.order.create({ data: { idempotencyKey: seedOrderKey, code: `VIB-${randomBytes(5).toString("hex").toUpperCase()}`, membershipId: favoriteMembership, productId, nameSnapshot: product.name, priceSnapshot: product.price, termsSnapshot: product.description } });
      });
    }
  }
  const owner = userByKey.get("owner")!;
  await prisma.notification.upsert({ where: { id: "seed-owner-note" }, create: { id: "seed-owner-note", userId: owner.id, kind: "SYSTEM", title: "Демо-режим готов", body: "Откройте задания или профиль и проверьте локальный сценарий." }, update: {} });

  console.info(`Seed complete: ${people.length} users, ${cosmetics.length} cosmetics, ${assignmentSeeds.length} assignments, 2 schools.`);
  console.info("Demo identities: student-new, student-7exp, student-24exp, student-99exp, teacher-1, teacher-2, school-admin, owner, other-student, other-teacher, other-admin.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
