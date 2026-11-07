import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const data = JSON.parse(await readFile("/app/contest-assets/content.json", "utf8"));
const bool = (value) => Boolean(value);
try {
  const owner = await db.user.findUniqueOrThrow({ where: { testProfileKey: "user-4" } });
  for (const row of data.about) await db.aboutPage.upsert({ where: { id: row.id }, create: row, update: {} });
  for (const row of data.images) await db.aboutImage.upsert({
    where: { id: row.id }, create: { ...row, uploaderId: owner.id }, update: {},
  });
  for (const row of data.team) await db.aboutTeamMember.upsert({
    where: { id: row.id }, create: { ...row, isVisible: bool(row.isVisible) }, update: {},
  });
  for (const row of data.sections) await db.aboutSection.upsert({
    where: { id: row.id }, create: { ...row, isVisible: bool(row.isVisible) }, update: {},
  });
  for (const row of data.partners) await db.cooperationPartner.upsert({
    where: { id: row.id }, create: { ...row, isPublished: bool(row.isPublished), isSynthetic: false, archivedAt: null }, update: {},
  });
  for (const row of data.media) await db.cooperationMedia.upsert({ where: { id: row.id }, create: row, update: {} });
  for (const row of data.documents) await db.projectDocument.upsert({
    where: { id: row.id }, create: { ...row, isSynthetic: false, publishedAt: row.publishedAt === null ? null : new Date(row.publishedAt) }, update: {},
  });
  for (const row of data.faq) await db.faqItem.upsert({
    where: { id: row.id }, create: { ...row, isFeatured: bool(row.isFeatured), isPublished: bool(row.isPublished), isSynthetic: false }, update: {},
  });
  for (const row of data.products) await db.product.upsert({
    where: { id: row.id }, create: { ...row, active: bool(row.active), isSynthetic: true }, update: {},
  });
  for (const row of data.productImages) await db.productImage.upsert({
    where: { productId: row.productId }, create: { ...row, uploaderId: owner.id }, update: {},
  });
  const teacher = await db.user.findUniqueOrThrow({ where: { testProfileKey: "user-2" } });
  const student = await db.user.findUniqueOrThrow({ where: { testProfileKey: "user-1" } });
  const membership = await db.membership.findFirstOrThrow({ where: { userId: student.id } });
  if (!membership.classId) throw new Error("Contest class is missing");
  for (const row of data.assignments) {
    const { id, ...assignment } = row;
    const seedKey = "contest-source-" + id;
    if (await db.assignment.findUnique({ where: { seedKey } })) continue;
    const questions = data.questions.filter((item) => item.assignmentId === id).map((item) => ({
      prompt: item.prompt, type: item.type, points: item.points, optionsJson: item.optionsJson, acceptedJson: item.acceptedJson,
      tolerance: item.tolerance, sortOrder: item.sortOrder, ignoreCase: bool(item.ignoreCase), trimWhitespace: bool(item.trimWhitespace), photoRequired: bool(item.photoRequired),
    }));
    await db.assignment.create({ data: {
      ...assignment, seedKey, schoolId: membership.schoolId, teacherId: teacher.id, published: true,
      dueAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      questions: { create: questions },
      targets: { create: { classId: membership.classId, recipients: { connect: { id: membership.id } } } },
    } });
  }
  console.log("Public contest content imported");
} finally { await db.$disconnect(); }
