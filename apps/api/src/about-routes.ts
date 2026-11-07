import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import sharp from "sharp";
import { prisma } from "./db.js";
import { authenticate, requireAuth, requireRole } from "./security.js";

const pageIdFor = () => "main";
const uploadDir = () => resolve(process.cwd(), process.env.UPLOAD_DIR ?? "./data/uploads");
const imageUrl = (id: string | null) => id ? `/api/about/images/${id}` : null;
const contentSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().max(8_000),
  teamMembers: z.array(z.object({
    name: z.string().trim().min(1).max(100),
    role: z.string().trim().min(1).max(120),
    description: z.string().max(1_000),
    imageAttachmentId: z.string().min(1).max(80).nullable(),
    isVisible: z.boolean(),
  }).strict()).max(40),
  sections: z.array(z.object({
    title: z.string().trim().min(1).max(160),
    body: z.string().max(8_000),
    imageAttachmentId: z.string().min(1).max(80).nullable(),
    isVisible: z.boolean(),
  }).strict()).max(40),
}).strict();

const pageInclude = {
  teamMembers: { orderBy: { sortOrder: "asc" as const } },
  sections: { orderBy: { sortOrder: "asc" as const } },
};

function hasAboutContent(page: { title: string; description: string; teamMembers: unknown[]; sections: unknown[] } | null) {
  return Boolean(page && (page.title.trim() !== "О Вайбе" || page.description.trim() || page.teamMembers.length || page.sections.length));
}

async function sharedAboutPage() {
  const [main, previousOwnerPage] = await Promise.all([
    prisma.aboutPage.findUnique({ where: { id: "main" }, include: pageInclude }),
    prisma.aboutPage.findUnique({ where: { id: "test" }, include: pageInclude }),
  ]);
  if (!previousOwnerPage) return main;
  const previousHasContent = hasAboutContent(previousOwnerPage);
  if (main && hasAboutContent(main) && (!previousHasContent || previousOwnerPage.updatedAt <= main.updatedAt)) return main;
  if (main && !previousHasContent) return main;
  return prisma.$transaction(async (tx) => {
    if (hasAboutContent(previousOwnerPage)) {
      await tx.aboutTeamMember.deleteMany({ where: { pageId: "main" } });
      await tx.aboutSection.deleteMany({ where: { pageId: "main" } });
    }
    await tx.aboutPage.upsert({
      where: { id: "main" },
      create: { id: "main", title: previousOwnerPage.title, description: previousOwnerPage.description, updatedById: previousOwnerPage.updatedById },
      update: { title: previousOwnerPage.title, description: previousOwnerPage.description, updatedById: previousOwnerPage.updatedById },
    });
    await tx.aboutTeamMember.updateMany({ where: { pageId: "test" }, data: { pageId: "main" } });
    await tx.aboutSection.updateMany({ where: { pageId: "test" }, data: { pageId: "main" } });
    await tx.aboutImage.updateMany({ where: { pageId: "test" }, data: { pageId: "main" } });
    return tx.aboutPage.findUniqueOrThrow({ where: { id: "main" }, include: pageInclude });
  });
}

function pageDto(page: { id: string; title: string; description: string; updatedAt: Date; teamMembers: Array<{ id: string; name: string; role: string; description: string; imageAttachmentId: string | null; sortOrder: number; isVisible: boolean }>; sections: Array<{ id: string; title: string; body: string; imageAttachmentId: string | null; sortOrder: number; isVisible: boolean }> }, owner: boolean) {
  return {
    id: page.id,
    title: page.title,
    description: page.description,
    updatedAt: page.updatedAt,
    teamMembers: page.teamMembers.filter((item) => owner || item.isVisible).map((item) => ({ ...item, imageUrl: imageUrl(item.imageAttachmentId) })),
    sections: page.sections.filter((item) => owner || item.isVisible).map((item) => ({ ...item, imageUrl: imageUrl(item.imageAttachmentId) })),
  };
}

export async function registerAboutRoutes(app: FastifyInstance) {
  app.get("/api/about", async (request, reply) => {
    const context = await requireAuth(request, reply);
    if (!context) return;
    const owner = context.user.platformRole === "PROJECT_OWNER";
    const page = owner ? await sharedAboutPage() : await prisma.aboutPage.findUnique({ where: { id: "main" }, include: pageInclude });
    if (!page) return reply.code(503).send({ error: "Страница «О нас» ещё не подготовлена миграцией базы данных" });
    return pageDto(page, owner);
  });

  app.put("/api/owner/about", async (request, reply) => {
    const context = await requireRole(request, reply, ["PROJECT_OWNER"]);
    if (!context) return;
    const pageId = pageIdFor();
    const parsed = contentSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Проверьте заголовок, поля участников и текстовые блоки" });
    const input = parsed.data;
    const current = pageId === "test"
      ? await prisma.aboutPage.upsert({ where: { id: "test" }, create: { id: "test", title: "О Вайбе", description: "" }, update: {}, include: { teamMembers: { select: { imageAttachmentId: true } }, sections: { select: { imageAttachmentId: true } } } })
      : await sharedAboutPage();
    if (!current) return reply.code(503).send({ error: "Страница «О нас» ещё не подготовлена миграцией базы данных" });
    const imageIds = [...new Set([...input.teamMembers, ...input.sections].flatMap((item) => item.imageAttachmentId ? [item.imageAttachmentId] : []))];
    const currentImageIds = new Set([...current.teamMembers, ...current.sections].flatMap((item) => item.imageAttachmentId ? [item.imageAttachmentId] : []));
    if (imageIds.length) {
      const images = await prisma.aboutImage.findMany({ where: { id: { in: imageIds }, ...(context.user.platformRole === "PROJECT_OWNER" ? {} : { pageId }) }, select: { id: true, uploaderId: true } });
      if (images.length !== imageIds.length || images.some((image) => image.uploaderId !== context.user.id && !currentImageIds.has(image.id))) {
        return reply.code(400).send({ error: "Для страницы можно использовать только свои фотографии или уже прикреплённые к ней" });
      }
    }
    const orphanedFiles = await prisma.$transaction(async (tx) => {
      await tx.aboutPage.update({ where: { id: pageId }, data: { title: input.title, description: input.description, updatedById: context.user.id } });
      await tx.aboutTeamMember.deleteMany({ where: { pageId } });
      await tx.aboutSection.deleteMany({ where: { pageId } });
      if (input.teamMembers.length) await tx.aboutTeamMember.createMany({ data: input.teamMembers.map((item, sortOrder) => ({ ...item, pageId, sortOrder })) });
      if (input.sections.length) await tx.aboutSection.createMany({ data: input.sections.map((item, sortOrder) => ({ ...item, pageId, sortOrder })) });
      const unused = await tx.aboutImage.findMany({ where: { pageId, teamMembers: { none: {} }, sections: { none: {} }, cooperationMedia: { is: null } }, select: { id: true, fileName: true } });
      if (unused.length) await tx.aboutImage.deleteMany({ where: { id: { in: unused.map((item) => item.id) } } });
      return unused.map((item) => item.fileName);
    });
    for (const fileName of orphanedFiles) await unlink(resolve(uploadDir(), fileName)).catch(() => undefined);
    const saved = await prisma.aboutPage.findUniqueOrThrow({ where: { id: pageId }, include: pageInclude });
    return pageDto(saved, true);
  });

  app.post("/api/owner/about/images", { bodyLimit: 12 * 1024 * 1024 }, async (request, reply) => {
    const context = await requireRole(request, reply, ["PROJECT_OWNER"]);
    if (!context) return;
    const pageId = pageIdFor();
    const page = await prisma.aboutPage.findUnique({ where: { id: pageId }, select: { id: true } });
    if (!page) return reply.code(503).send({ error: "Страница «О нас» ещё не подготовлена миграцией базы данных" });
    let buffer: Buffer | null = null;
    let mimeType = "";
    try {
      for await (const part of request.parts()) {
        if (part.type !== "file") continue;
        if (buffer) return reply.code(400).send({ error: "За один раз можно загрузить одно изображение" });
        if (part.file.truncated) return reply.code(413).send({ error: "Изображение больше 10 МБ" });
        buffer = await part.toBuffer();
        mimeType = part.mimetype;
      }
    } catch (error) {
      const multipartError = error as { code?: unknown };
      if (multipartError.code === "FST_REQ_FILE_TOO_LARGE") return reply.code(413).send({ error: "Изображение больше 10 МБ" });
      throw error;
    }
    if (!buffer?.length) return reply.code(400).send({ error: "Выберите изображение JPEG, PNG или WebP" });
    if (buffer.byteLength > 10 * 1024 * 1024) return reply.code(413).send({ error: "Изображение больше 10 МБ" });
    let image;
    try { image = sharp(buffer, { failOn: "error", limitInputPixels: 40_000_000 }); }
    catch { return reply.code(415).send({ error: "Не удалось прочитать изображение" }); }
    const metadata = await image.metadata().catch(() => null);
    const mimeMatches = (mimeType === "image/jpeg" && metadata?.format === "jpeg") || (mimeType === "image/png" && metadata?.format === "png") || (mimeType === "image/webp" && metadata?.format === "webp");
    if (!metadata?.width || !metadata.height || !mimeMatches || metadata.width > 12_000 || metadata.height > 12_000 || metadata.width * metadata.height > 40_000_000) {
      return reply.code(415).send({ error: "Поддерживаются только корректные JPEG, PNG и WebP до 40 мегапикселей" });
    }
    const output = await image.rotate().flatten({ background: "#ffffff" }).jpeg({ quality: 94, mozjpeg: true }).toBuffer();
    const fileName = `${randomBytes(32).toString("hex")}.jpg`;
    await mkdir(uploadDir(), { recursive: true });
    const filePath = resolve(uploadDir(), fileName);
    await writeFile(filePath, output, { flag: "wx" });
    try {
      const saved = await prisma.aboutImage.create({ data: { pageId, uploaderId: context.user.id, fileName, mimeType: "image/jpeg" }, select: { id: true } });
      return reply.code(201).send({ id: saved.id, url: imageUrl(saved.id), mimeType: "image/jpeg" });
    } catch (error) {
      await unlink(filePath).catch(() => undefined);
      throw error;
    }
  });

  app.delete<{ Params: { id: string } }>("/api/owner/about/images/:id", async (request, reply) => {
    const context = await requireRole(request, reply, ["PROJECT_OWNER"]);
    if (!context) return;
    const pageId = pageIdFor();
    const image = await prisma.aboutImage.findUnique({ where: { id: request.params.id }, select: { id: true, pageId: true, fileName: true } });
    if (!image || (context.user.platformRole !== "PROJECT_OWNER" && image.pageId !== pageId)) return reply.code(404).send({ error: "Изображение не найдено" });
    const cooperationUse = await prisma.cooperationMedia.findFirst({ where: { imageAttachmentId: image.id }, select: { id: true } });
    if (cooperationUse) return reply.code(409).send({ error: "Сначала уберите это фото из точки сотрудничества и сохраните изменения" });
    try {
      await prisma.aboutImage.delete({ where: { id: image.id } });
    } catch {
      return reply.code(409).send({ error: "Сначала уберите изображение из блоков страницы и сохраните изменения" });
    }
    await unlink(resolve(uploadDir(), image.fileName)).catch(() => undefined);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>("/api/about/images/:id", async (request, reply) => {
    const context = await authenticate(request);
    const owner = context?.user.platformRole === "PROJECT_OWNER";
    const image = await prisma.aboutImage.findUnique({ where: { id: request.params.id }, select: { id: true, fileName: true } });
    if (!image) return reply.code(404).send({ error: "Изображение не найдено" });
    if (!owner) {
      const pageId = "main";
      const reference = await prisma.aboutImage.findFirst({ where: { id: image.id, OR: [{ teamMembers: { some: { pageId, isVisible: true } } }, { sections: { some: { pageId, isVisible: true } } }] }, select: { id: true } });
      const partnerReference = await prisma.cooperationMedia.findFirst({ where: { imageAttachmentId: image.id, partner: { isPublished: true, archivedAt: null, isSynthetic: false } }, select: { id: true } });
      if (!reference && !partnerReference) return reply.code(404).send({ error: "Изображение не найдено" });
    }
    const bytes = await readFile(resolve(uploadDir(), image.fileName)).catch(() => null);
    if (!bytes) return reply.code(404).send({ error: "Изображение больше недоступно" });
    reply.header("Content-Type", "image/jpeg").header("Content-Disposition", "inline; filename=about-photo.jpg").header("Cache-Control", "private, max-age=3600").header("X-Content-Type-Options", "nosniff");
    return reply.send(bytes);
  });
}
