import "dotenv/config";
import path from "node:path";
import { levelForExp } from "../packages/shared/src/index.js";
import { prisma } from "../apps/api/src/db.js";
import { cosmetics } from "./cosmetics.js";

function assertPresentationDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url?.startsWith("file:")) throw new Error("Presentation seed requires an explicit local SQLite DATABASE_URL under data/presentation or data/e2e-runs; the default/main database is not allowed.");
  const rawPath = decodeURIComponent(url.slice("file:".length).split("?")[0]!);
  const databasePath = path.resolve(path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), "prisma", rawPath));
  const dataRoot = path.resolve(process.cwd(), "data");
  const relative = path.relative(dataRoot, databasePath);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !["presentation", "e2e-runs"].some((directory) => relative.startsWith(`${directory}${path.sep}`))) {
    throw new Error(`Refusing to seed outside data/presentation or data/e2e-runs (resolved DATABASE_URL: ${databasePath})`);
  }
}

async function main() {
  assertPresentationDatabase();
  const school = await prisma.school.upsert({ where: { name_city: { name: "Школа Вайб № 21", city: "Казань" } }, create: { name: "Школа Вайб № 21", city: "Казань", timezone: "Europe/Moscow", isSynthetic: true }, update: { isSynthetic: true } });
  if (school.archivedAt) throw new Error("The presentation school is archived; refusing to reactivate or seed it. Restore it through the owner interface first.");
  const normalizedName = (value: string) => value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleUpperCase("ru-RU");
  let schoolClass = await prisma.schoolClass.findFirst({ where: { schoolId: school.id, normalizedName: normalizedName("7A"), archivedAt: null } });
  if (!schoolClass) {
    const archivedCanonicalClass = await prisma.schoolClass.findFirst({ where: { schoolId: school.id, name: "7A", archivedAt: { not: null } } });
    if (archivedCanonicalClass) throw new Error("The canonical 7A class is archived; refusing to recreate it or move demo profiles. Restore it through the school-admin interface first.");
    schoolClass = await prisma.schoolClass.create({ data: { schoolId: school.id, name: "7A", normalizedName: normalizedName("7A") } });
  }
  const profiles = [
    { key: "user-1", displayName: "Пользователь 1", role: "STUDENT" as const },
    { key: "user-2", displayName: "Пользователь 2", role: "TEACHER" as const },
    { key: "user-3", displayName: "Пользователь 3", role: "SCHOOL_ADMIN" as const },
    { key: "user-4", displayName: "Пользователь 4", role: "PROJECT_OWNER" as const },
  ];
  const userIds: Record<string, string> = {};
  const memberships: Record<string, string> = {};
  for (const profile of profiles) {
    const user = await prisma.user.upsert({
      where: { testProfileKey: profile.key },
      create: { testProfileKey: profile.key, displayName: profile.displayName, firstName: "", lastName: "", ...(profile.role === "PROJECT_OWNER" ? { platformRole: "PROJECT_OWNER" as const } : {}) },
      update: { displayName: profile.displayName, firstName: "", lastName: "", ...(profile.role === "PROJECT_OWNER" ? { platformRole: "PROJECT_OWNER" as const } : { platformRole: null }) },
    });
    userIds[profile.key] = user.id;
    if (profile.role === "PROJECT_OWNER") {
      const membership = await prisma.membership.findFirst({ where: { userId: user.id } });
      if (membership) throw new Error("The project-owner test profile must not have school membership");
      await prisma.profileAppearance.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} });
      await prisma.userPreferences.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} });
      continue;
    }
    const membership = await prisma.membership.upsert({
      where: { userId_schoolId: { userId: user.id, schoolId: school.id } },
      create: { userId: user.id, schoolId: school.id, classId: schoolClass.id, role: profile.role, isTeacher: profile.role === "TEACHER", isSchoolAdmin: profile.role === "SCHOOL_ADMIN" },
      update: {},
    });
    memberships[profile.key] = membership.id;
    await prisma.profileAppearance.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} });
    await prisma.userPreferences.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} });
  }
  await prisma.teacherClass.upsert({ where: { teacherId_classId: { teacherId: memberships["user-2"]!, classId: schoolClass.id } }, create: { teacherId: memberships["user-2"]!, classId: schoolClass.id }, update: {} });

  if (process.env.CONTEST_EMPTY_ASSIGNMENTS !== "true") {
  const teacherId = userIds["user-2"]!;
  const studentMembershipId = memberships["user-1"]!;
  const presentationAssignments = [
    {
      seedKey: "presentation-quick-space",
      title: "Короткая разминка: космос",
      subject: "Естествознание",
      category: "Учёба",
      description: "Выбери правильный ответ и получи первые Эйнштейны за работу.",
      durationMinutes: 10,
      question: { prompt: "Сколько планет в Солнечной системе?", type: "NUMBER" as const, points: 1, acceptedJson: JSON.stringify(["8"]), optionsJson: "[]", tolerance: 0, ignoreCase: true, trimWhitespace: true, photoRequired: false, sortOrder: 0 },
    },
    {
      seedKey: "presentation-photo-observation",
      title: "Наблюдение: свет вокруг нас",
      subject: "Окружающий мир",
      category: "Творчество",
      description: "Назови источник света рядом с тобой и приложи своё фото или рисунок наблюдения.",
      durationMinutes: null,
      question: { prompt: "Расскажи, что ты заметил(а), и прикрепи фотографию наблюдения.", type: "LONG_ANSWER" as const, points: 5, acceptedJson: "[]", optionsJson: "[]", tolerance: 0, ignoreCase: true, trimWhitespace: true, photoRequired: true, sortOrder: 0 },
    },
  ];
  for (const item of presentationAssignments) {
    const dueAt = new Date(Date.now() + 14 * 86_400_000);
    const existing = await prisma.assignment.findUnique({ where: { seedKey: item.seedKey }, include: { _count: { select: { submissions: true } } } });
    if (!existing) {
      await prisma.assignment.create({
        data: {
          seedKey: item.seedKey, schoolId: school.id, teacherId, title: item.title, subject: item.subject, category: item.category,
          description: item.description, dueAt, durationMinutes: item.durationMinutes, published: true,
          questions: { create: item.question },
          targets: { create: { classId: schoolClass.id, recipients: { connect: { id: studentMembershipId } } } },
        },
      });
    } else if (existing._count.submissions === 0 && !existing.archived) {
      await prisma.assignment.update({ where: { id: existing.id }, data: { dueAt } });
    }
  }

  }

  const catalog = new Map<string, { id: string; unlockLevel: number }>();
  for (const item of cosmetics) {
    const saved = await prisma.cosmeticItem.upsert({
      where: { slug: item.slug },
      create: { slug: item.slug, type: item.type, unlockLevel: item.level, displayName: item.name, assetKey: item.asset, value: item.value, groupKey: item.group },
      update: { type: item.type, unlockLevel: item.level, displayName: item.name, assetKey: item.asset, value: item.value, groupKey: item.group },
    });
    catalog.set(item.slug, { id: saved.id, unlockLevel: saved.unlockLevel });
  }
  for (const profile of profiles.filter((row) => row.role !== "PROJECT_OWNER")) {
    const userId = userIds[profile.key]!;
    const membershipId = memberships[profile.key]!;
    const membership = await prisma.membership.findUniqueOrThrow({ where: { id: membershipId }, select: { totalExp: true } });
    const eligible = [...catalog.values()].filter((item) => item.unlockLevel <= levelForExp(membership.totalExp));
    const existing = await prisma.cosmeticUnlock.findMany({ where: { userId, cosmeticId: { in: eligible.map((item) => item.id) } }, select: { cosmeticId: true } });
    const existingIds = new Set(existing.map((item) => item.cosmeticId));
    const missing = eligible.filter((item) => !existingIds.has(item.id));
    if (missing.length) await prisma.cosmeticUnlock.createMany({ data: missing.map((item) => ({ userId, cosmeticId: item.id, source: "PRESENTATION_SEED" })) });
  }
  const globalProduct = await prisma.product.upsert({
    where: { slug: "presentation-sticker" },
    create: { slug: "presentation-sticker", scope: "GLOBAL", name: "Набор стикеров", description: "Небольшая награда за старание.", category: "Творчество", imageKey: "stickers", price: 5, stock: 20, perUserLimit: 3, isSynthetic: true },
    update: { isSynthetic: true },
  });
  await prisma.product.upsert({
    where: { slug: "presentation-reading-bookmark" },
    create: { slug: "presentation-reading-bookmark", scope: "GLOBAL", name: "Закладка для чтения", description: "Небольшая награда для новой интересной книги.", category: "Книги", imageKey: "book", price: 8, stock: 12, perUserLimit: 2, isSynthetic: true },
    update: { isSynthetic: true },
  });
  await prisma.product.upsert({
    where: { slug: "presentation-school-choice" },
    create: { slug: "presentation-school-choice", schoolId: school.id, scope: "SCHOOL", name: "Выбор активности", description: "Школьная награда с выдачей сотрудником.", category: "Школьная жизнь", imageKey: "gift", price: 5, stock: 20, perUserLimit: 1, isSynthetic: true },
    update: { isSynthetic: true },
  });
  await prisma.product.upsert({
    where: { slug: "presentation-school-book" },
    create: { slug: "presentation-school-book", schoolId: school.id, scope: "SCHOOL", name: "Билет в книжный уголок", description: "Выбери книгу из подборки школьной библиотеки.", category: "Книги", imageKey: "book", price: 5, stock: 10, perUserLimit: 1, isSynthetic: true },
    update: { isSynthetic: true },
  });
  console.info(JSON.stringify({ school: school.name, className: schoolClass.name, profiles: profiles.length, globalProduct: globalProduct.slug }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
