import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { prisma } from "./db.js";
import { requireAuth, requireRole } from "./security.js";

const uploadDir = () => resolve(process.cwd(), process.env.UPLOAD_DIR ?? "./data/uploads");

export async function registerUploadRoutes(app: FastifyInstance) {
  app.post("/api/files", { bodyLimit: 52 * 1024 * 1024 }, async (request, reply) => {
    const context = await requireAuth(request, reply);
    if (!context) return;
    if (!context.membership || !["STUDENT", "TEACHER"].includes(context.membership.role)) return reply.code(403).send({ error: "Фото может загружать ученик или учитель своей школы" });
    const files = [] as Array<{ buffer: Buffer; mimetype: string }>;
    for await (const part of request.parts()) {
      if (part.type !== "file") continue;
      if (part.file.truncated) return reply.code(413).send({ error: "Фото больше 10 МБ" });
      files.push({ buffer: await part.toBuffer(), mimetype: part.mimetype });
      if (files.length > 5) return reply.code(413).send({ error: "За один раз можно добавить не больше пяти фото" });
    }
    if (!files.length) return reply.code(400).send({ error: "Выберите фотографии JPEG, PNG или WebP" });
    const saved = [] as Array<{ id: string; url: string; fileName: string }>;
    for (const file of files) {
      let image;
      try { image = sharp(file.buffer, { failOn: "error", limitInputPixels: 40_000_000 }); }
      catch { return reply.code(400).send({ error: "Не удалось прочитать изображение" }); }
      const meta = await image.metadata().catch(() => null);
      const mimeMatches = (file.mimetype === "image/jpeg" && meta?.format === "jpeg") || (file.mimetype === "image/png" && meta?.format === "png") || (file.mimetype === "image/webp" && meta?.format === "webp");
      if (!meta?.width || !meta.height || !mimeMatches || meta.width > 12_000 || meta.height > 12_000 || meta.width * meta.height > 40_000_000) return reply.code(415).send({ error: "Поддерживаются только корректные JPEG, PNG и WebP до 40 мегапикселей" });
      const output = await image.rotate().flatten({ background: "#ffffff" }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
      const fileName = `${randomBytes(32).toString("hex")}.jpg`;
      await mkdir(uploadDir(), { recursive: true });
      await import("node:fs/promises").then(({ writeFile }) => writeFile(resolve(uploadDir(), fileName), output, { flag: "wx" }));
      try {
        const upload = await prisma.upload.create({ data: { userId: context.user.id, membershipId: context.membership.id, fileName, mimeType: "image/jpeg", expiresAt: new Date(Date.now() + 24 * 60 * 60_000) } });
        saved.push({ id: upload.id, url: `/api/files/${upload.id}`, fileName: "Фото решения" });
      } catch (error) {
        await unlink(resolve(uploadDir(), fileName)).catch(() => undefined);
        throw error;
      }
    }
    return reply.code(201).send({ files: saved });
  });

  app.get<{ Params: { id: string } }>("/api/files/:id", async (request, reply) => {
    const context = await requireAuth(request, reply);
    if (!context) return;
    const file = await prisma.upload.findUnique({
      where: { id: request.params.id },
      include: {
        assignment: { include: { targets: { select: { classId: true } } } },
        answer: {
          include: {
            submission: {
              include: {
                assignment: { include: { targets: { select: { classId: true } } } },
              },
            },
          },
        },
      },
    });
    if (!file || file.expiresAt <= new Date() && !file.answerId) return reply.code(404).send({ error: "Файл не найден" });
    let canRead = file.userId === context.user.id;
    const assignment = file.assignment ?? file.answer?.submission.assignment;
    if (!canRead && assignment && context.membership?.role === "STUDENT" && context.membership.schoolId === assignment.schoolId) {
      canRead = Boolean(await prisma.assignmentTarget.findFirst({ where: { assignmentId: assignment.id, recipients: { some: { id: context.membership.id } } }, select: { id: true } }));
    }
    if (!canRead && assignment && (context.membership?.role === "TEACHER" || context.membership?.isTeacher || context.membership?.role === "SCHOOL_ADMIN" || context.membership?.isSchoolAdmin) && assignment.teacherId === context.user.id && assignment.schoolId === context.membership.schoolId) {
      const teacherClasses = await prisma.teacherClass.findMany({ where: { teacherId: context.membership.id, active: true, schoolClass: { archivedAt: null } }, select: { classId: true } });
      canRead = Boolean(file.answer) || assignment.targets.some((target) => teacherClasses.some((item) => item.classId === target.classId));
    }
    if (!canRead) return reply.code(403).send({ error: "Нет доступа к этому файлу" });
    const bytes = await readFile(resolve(uploadDir(), file.fileName)).catch(() => null);
    if (!bytes) return reply.code(404).send({ error: "Файл больше недоступен" });
    reply.header("Content-Type", "image/jpeg").header("Content-Disposition", "inline; filename=solution.jpg").header("Cache-Control", "private, no-store").header("X-Content-Type-Options", "nosniff");
    return reply.send(bytes);
  });

  const uploadProductPhoto = async (request: import("fastify").FastifyRequest<{ Params: { id: string } }>, reply: import("fastify").FastifyReply, scope: "SCHOOL" | "GLOBAL") => {
    const context = scope === "SCHOOL"
      ? await requireRole(request, reply, ["SCHOOL_ADMIN"])
      : await requireRole(request, reply, ["PROJECT_OWNER"]);
    if (!context) return;

    const product = await prisma.product.findFirst({ where: scope === "SCHOOL"
      ? { id: request.params.id, scope: "SCHOOL", schoolId: context.membership?.schoolId }
      : { id: request.params.id, scope: "GLOBAL" } });
    if (!product) return reply.code(404).send({ error: "Товар не найден в доступном каталоге" });

    let buffer: Buffer | null = null;
    let mimeType = "";
    for await (const part of request.parts()) {
      if (part.type !== "file") continue;
      if (buffer) return reply.code(400).send({ error: "Для товара можно загрузить одно фото за раз" });
      if (part.file.truncated) return reply.code(413).send({ error: "Фото больше 10 МБ" });
      buffer = await part.toBuffer();
      mimeType = part.mimetype;
    }
    if (!buffer) return reply.code(400).send({ error: "Выберите JPEG, PNG или WebP изображение" });

    let image;
    try { image = sharp(buffer, { failOn: "error", limitInputPixels: 40_000_000 }); }
    catch { return reply.code(415).send({ error: "Не удалось прочитать изображение" }); }
    const metadata = await image.metadata().catch(() => null);
    const mimeMatches = (mimeType === "image/jpeg" && metadata?.format === "jpeg") || (mimeType === "image/png" && metadata?.format === "png") || (mimeType === "image/webp" && metadata?.format === "webp");
    if (!metadata?.width || !metadata.height || !mimeMatches || metadata.width > 12_000 || metadata.height > 12_000 || metadata.width * metadata.height > 40_000_000) return reply.code(415).send({ error: "Поддерживаются только корректные JPEG, PNG и WebP до 40 мегапикселей" });

    const output = await image.rotate().flatten({ background: "#ffffff" }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
    const fileName = `${randomBytes(32).toString("hex")}.jpg`;
    await mkdir(uploadDir(), { recursive: true });
    const filePath = resolve(uploadDir(), fileName);
    await writeFile(filePath, output, { flag: "wx" });
    try {
      const previous = await prisma.productImage.findUnique({ where: { productId: product.id }, select: { fileName: true } });
      await prisma.productImage.upsert({
        where: { productId: product.id },
        create: { productId: product.id, uploaderId: context.user.id, fileName, mimeType: "image/jpeg" },
        update: { uploaderId: context.user.id, fileName, mimeType: "image/jpeg", createdAt: new Date() },
      });
      if (previous) await unlink(resolve(uploadDir(), previous.fileName)).catch(() => undefined);
      return reply.code(previous ? 200 : 201).send({ ok: true, imageUrl: `/api/market/products/${product.id}/image` });
    } catch (error) {
      await unlink(filePath).catch(() => undefined);
      throw error;
    }
  };

  app.post<{ Params: { id: string } }>("/api/admin/products/:id/image", { bodyLimit: 12 * 1024 * 1024 }, (request, reply) => uploadProductPhoto(request, reply, "SCHOOL"));
  app.post<{ Params: { id: string } }>("/api/owner/products/:id/image", { bodyLimit: 12 * 1024 * 1024 }, (request, reply) => uploadProductPhoto(request, reply, "GLOBAL"));

  app.get<{ Params: { id: string } }>("/api/market/products/:id/image", async (request, reply) => {
    const context = await requireAuth(request, reply);
    if (!context) return;
    const isProjectOwner = context.user.platformRole === "PROJECT_OWNER";
    const product = await prisma.product.findFirst({ where: { id: request.params.id, ...(isProjectOwner ? {} : { OR: [
      { scope: "GLOBAL" },
      { scope: "SCHOOL", schoolId: context.membership?.schoolId },
    ] }) }, include: { image: true } });
    if (!product?.image) return reply.code(404).send({ error: "У товара пока нет фотографии" });
    const isVisibleGlobal = product.scope === "GLOBAL" && (product.active || isProjectOwner);
    const isVisibleSchool = product.scope === "SCHOOL" && Boolean(context.membership && context.membership.schoolId === product.schoolId && context.membership.active && context.membership.approved && product.active);
    if (!isVisibleGlobal && !isVisibleSchool) return reply.code(403).send({ error: "Нет доступа к фотографии этого товара" });
    const bytes = await readFile(resolve(uploadDir(), product.image.fileName)).catch(() => null);
    if (!bytes) return reply.code(404).send({ error: "Фотография больше недоступна" });
    reply.header("Content-Type", "image/jpeg").header("Content-Disposition", "inline; filename=product.jpg").header("Cache-Control", "private, no-store").header("X-Content-Type-Options", "nosniff");
    return reply.send(bytes);
  });
}

export async function cleanExpiredUploads() {
  const expired = await prisma.upload.findMany({ where: { answerId: null, assignmentId: null, expiresAt: { lt: new Date() } }, select: { id: true, fileName: true } });
  for (const file of expired) {
    await unlink(resolve(uploadDir(), file.fileName)).catch(() => undefined);
    await prisma.upload.deleteMany({ where: { id: file.id, answerId: null, assignmentId: null } });
  }
}
