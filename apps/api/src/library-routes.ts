import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "./db.js";
import { authenticate, requireAuth, requireRole } from "./security.js";

const uploadDir = () => resolve(process.cwd(), process.env.UPLOAD_DIR ?? "./data/uploads");
const documentStatuses = ["DRAFT", "PUBLISHED", "UNPUBLISHED"] as const;
const documentInput = z.object({
  title: z.string().trim().min(3).max(180),
  description: z.string().trim().max(4_000).default(""),
  category: z.string().trim().min(1).max(80),
  status: z.enum(documentStatuses).default("DRAFT"),
  sortOrder: z.coerce.number().int().min(0).max(100_000).default(0),
}).strict();
const documentPatch = documentInput.partial().strict().refine((value) => Object.keys(value).length > 0, "Укажите хотя бы одно изменение");
const reviewInput = z.object({ rating: z.number().int().min(1).max(5), body: z.string().trim().min(10).max(1_000) }).strict();
const reviewDecision = z.object({ status: z.enum(["APPROVED", "REJECTED"]) }).strict();
const allowedFormats = {
  ".pdf": { mime: "application/pdf", signature: (data: Buffer) => data.subarray(0, 5).toString("ascii") === "%PDF-" },
  ".jpg": { mime: "image/jpeg", signature: (data: Buffer) => data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff },
  ".jpeg": { mime: "image/jpeg", signature: (data: Buffer) => data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff },
  ".png": { mime: "image/png", signature: (data: Buffer) => data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  ".webp": { mime: "image/webp", signature: (data: Buffer) => data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP" },
} as const;
type UploadData = { buffer: Buffer; originalName: string; mimeType: string };

function safeOriginalName(value: string, extension: string) {
  const leaf = basename(value.replace(/\\/gu, "/")).replace(/[\u0000-\u001f\u007f]/gu, "").trim().slice(0, 160);
  return leaf || `document${extension}`;
}

function verifyUpload(upload: UploadData) {
  const extension = extname(upload.originalName).toLowerCase() as keyof typeof allowedFormats;
  const format = allowedFormats[extension];
  const mimeType = upload.mimeType === "image/jpg" ? "image/jpeg" : upload.mimeType;
  if (!format || format.mime !== mimeType || !format.signature(upload.buffer)) return null;
  return { extension, mimeType: format.mime, originalName: safeOriginalName(upload.originalName, extension) };
}

type UploadPartsResult = { ok: true; upload: UploadData & NonNullable<ReturnType<typeof verifyUpload>>; fields: Record<string, string> } | { ok: false; status: number; message: string };

async function readUploadParts(request: import("fastify").FastifyRequest): Promise<UploadPartsResult> {
  let upload: UploadData | null = null;
  const fields: Record<string, string> = {};
  try {
    for await (const part of request.parts()) {
      if (part.type === "field") {
        fields[part.fieldname] = String(part.value ?? "");
        continue;
      }
      if (upload) { await part.toBuffer().catch(() => undefined); return { ok: false, status: 400, message: "Прикрепите только один файл" }; }
      const buffer = await part.toBuffer();
      if (part.file.truncated) return { ok: false, status: 413, message: "Файл больше 10 МБ" };
      upload = { buffer, originalName: part.filename, mimeType: part.mimetype };
    }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "FST_REQ_FILE_TOO_LARGE") return { ok: false, status: 413, message: "Файл больше 10 МБ" };
    throw error;
  }
  if (!upload?.buffer.length) return { ok: false, status: 400, message: "Прикрепите PDF, JPEG, PNG или WebP" };
  const verified = verifyUpload(upload);
  if (!verified) return { ok: false, status: 415, message: "Формат файла не совпадает с его содержимым. Поддерживаются PDF, JPEG, PNG и WebP." };
  return { ok: true, upload: { ...upload, ...verified }, fields };
}

async function storeUpload(buffer: Buffer, extension: string) {
  const fileName = `${randomBytes(32).toString("hex")}${extension}`;
  await mkdir(uploadDir(), { recursive: true });
  await writeFile(resolve(uploadDir(), fileName), buffer, { flag: "wx", mode: 0o640 });
  return fileName;
}

function documentDto(row: { id: string; title: string; description: string; category: string; status: string; sortOrder: number; originalName: string; mimeType: string; sizeBytes: number; publishedAt: Date | null; createdAt: Date; updatedAt: Date }) {
  return { id: row.id, title: row.title, description: row.description, category: row.category, status: row.status, sortOrder: row.sortOrder, fileName: row.originalName, mimeType: row.mimeType, sizeBytes: row.sizeBytes, publishedAt: row.publishedAt, createdAt: row.createdAt, updatedAt: row.updatedAt, fileUrl: `/api/documents/${encodeURIComponent(row.id)}/file` };
}

const reviewSelect = { id: true, rating: true, body: true, status: true, createdAt: true, moderatedAt: true } as const;

export async function registerLibraryRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { q?: string; category?: string } }>("/api/documents", async (request) => {
    const q = request.query.q?.trim().slice(0, 120) ?? "";
    const category = request.query.category?.trim().slice(0, 80) ?? "";
    const rows = await prisma.projectDocument.findMany({
      where: { isSynthetic: false, status: "PUBLISHED", ...(category ? { category } : {}), ...(q ? { OR: [{ title: { contains: q } }, { description: { contains: q } }, { category: { contains: q } }] } : {}) },
      orderBy: [{ sortOrder: "asc" }, { publishedAt: "desc" }, { createdAt: "desc" }], take: 200,
    });
    return { items: rows.map(documentDto), categories: [...new Set(rows.map((row) => row.category))] };
  });

  app.get("/api/owner/documents", async (request, reply) => {
    const context = await requireRole(request, reply, ["PROJECT_OWNER"]);
    if (!context) return;
    const rows = await prisma.projectDocument.findMany({ orderBy: [{ status: "asc" }, { sortOrder: "asc" }, { updatedAt: "desc" }] });
    return rows.map(documentDto);
  });

  app.post("/api/owner/documents", { bodyLimit: 12 * 1024 * 1024 }, async (request, reply) => {
    const context = await requireRole(request, reply, ["PROJECT_OWNER"]);
    if (!context) return;
    const parts = await readUploadParts(request);
    if (!parts.ok) return reply.code(parts.status).send({ error: parts.message });
    const parsed = documentInput.safeParse(parts.fields);
    if (!parsed.success) return reply.code(400).send({ error: "Проверьте название, описание, категорию и статус документа" });
    const fileName = await storeUpload(parts.upload.buffer, parts.upload.extension);
    try {
      const saved = await prisma.projectDocument.create({ data: {
        ...parsed.data, isSynthetic: false, fileName,
        originalName: parts.upload.originalName, mimeType: parts.upload.mimeType, sizeBytes: parts.upload.buffer.byteLength,
        publishedAt: parsed.data.status === "PUBLISHED" ? new Date() : null,
      } });
      return reply.code(201).send(documentDto(saved));
    } catch (error) { await unlink(resolve(uploadDir(), fileName)).catch(() => undefined); throw error; }
  });

  app.patch<{ Params: { id: string } }>("/api/owner/documents/:id", async (request, reply) => {
    const context = await requireRole(request, reply, ["PROJECT_OWNER"]);
    if (!context) return;
    const parsed = documentPatch.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Проверьте изменения документа" });
    const current = await prisma.projectDocument.findUnique({ where: { id: request.params.id } });
    if (!current) return reply.code(404).send({ error: "Документ не найден" });
    const status = parsed.data.status ?? current.status;
    const saved = await prisma.projectDocument.update({ where: { id: current.id }, data: { ...parsed.data, isSynthetic: false, publishedAt: status === "PUBLISHED" ? current.status === "PUBLISHED" ? current.publishedAt : new Date() : null } });
    return documentDto(saved);
  });

  app.post<{ Params: { id: string } }>("/api/owner/documents/:id/file", { bodyLimit: 12 * 1024 * 1024 }, async (request, reply) => {
    const context = await requireRole(request, reply, ["PROJECT_OWNER"]);
    if (!context) return;
    const current = await prisma.projectDocument.findUnique({ where: { id: request.params.id } });
    if (!current) return reply.code(404).send({ error: "Документ не найден" });
    const parts = await readUploadParts(request);
    if (!parts.ok) return reply.code(parts.status).send({ error: parts.message });
    const fileName = await storeUpload(parts.upload.buffer, parts.upload.extension);
    let saved;
    try {
      saved = await prisma.projectDocument.update({ where: { id: current.id }, data: { isSynthetic: false, fileName, originalName: parts.upload.originalName, mimeType: parts.upload.mimeType, sizeBytes: parts.upload.buffer.byteLength } });
    } catch (error) { await unlink(resolve(uploadDir(), fileName)).catch(() => undefined); throw error; }
    await unlink(resolve(uploadDir(), current.fileName)).catch(() => undefined);
    return documentDto(saved);
  });

  app.post("/api/owner/documents/order", async (request, reply) => {
    const context = await requireRole(request, reply, ["PROJECT_OWNER"]);
    if (!context) return;
    const parsed = z.object({ ids: z.array(z.string().min(1)).max(500) }).strict().safeParse(request.body);
    if (!parsed.success || new Set(parsed.data?.ids ?? []).size !== parsed.data?.ids.length) return reply.code(400).send({ error: "Проверьте порядок документов" });
    const ids = parsed.data.ids;
    const owned = await prisma.projectDocument.findMany({ where: { id: { in: ids } }, select: { id: true } });
    if (owned.length !== ids.length) return reply.code(409).send({ error: "Список документов изменился. Обновите страницу." });
    await prisma.$transaction(ids.map((id, sortOrder) => prisma.projectDocument.updateMany({ where: { id }, data: { sortOrder, isSynthetic: false } })));
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/api/owner/documents/:id", async (request, reply) => {
    const context = await requireRole(request, reply, ["PROJECT_OWNER"]);
    if (!context) return;
    const current = await prisma.projectDocument.findUnique({ where: { id: request.params.id } });
    if (!current) return reply.code(404).send({ error: "Документ не найден" });
    await prisma.projectDocument.delete({ where: { id: current.id } });
    await unlink(resolve(uploadDir(), current.fileName)).catch(() => undefined);
    return { ok: true };
  });

  app.get<{ Params: { id: string }; Querystring: { download?: string } }>("/api/documents/:id/file", async (request, reply) => {
    const context = await authenticate(request);
    const owner = context?.user.platformRole === "PROJECT_OWNER";
    const document = await prisma.projectDocument.findFirst({ where: { id: request.params.id, ...(owner ? {} : { isSynthetic: false }) } });
    if (!document || (document.status !== "PUBLISHED" && !owner)) return reply.code(404).send({ error: "Документ не найден" });
    const bytes = await readFile(resolve(uploadDir(), document.fileName)).catch(() => null);
    if (!bytes) return reply.code(404).send({ error: "Файл документа больше недоступен" });
    const encoded = encodeURIComponent(document.originalName).replace(/[!'()*]/gu, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    reply.type(document.mimeType).header("X-Content-Type-Options", "nosniff").header("Cache-Control", "private, max-age=300");
    reply.header("Content-Disposition", `${request.query.download === "1" ? "attachment" : "inline"}; filename="document${extname(document.originalName).toLowerCase()}"; filename*=UTF-8''${encoded}`);
    return reply.send(bytes);
  });

  app.get("/api/reviews", async (request) => {
    const isSynthetic = false;
    const [rows, aggregate] = await Promise.all([
      prisma.publicReview.findMany({ where: { isSynthetic, status: "APPROVED" }, select: reviewSelect, orderBy: { createdAt: "desc" }, take: 100 }),
      prisma.publicReview.aggregate({ where: { isSynthetic, status: "APPROVED" }, _avg: { rating: true }, _count: { _all: true } }),
    ]);
    return { items: rows, average: aggregate._avg.rating ? Math.round(aggregate._avg.rating * 10) / 10 : null, count: aggregate._count._all };
  });

  app.post("/api/reviews", async (request, reply) => {
    const context = await requireAuth(request, reply);
    if (!context) return;
    if (context.user.platformRole === "PROJECT_OWNER") return reply.code(403).send({ error: "Владелец сайта не может отправить отзыв" });
    const parsed = reviewInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Выберите оценку от 1 до 5 и напишите отзыв длиной от 10 до 1 000 символов" });
    const isSynthetic = context.authSource === "TEST";
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [pending, recentCount, duplicate] = await Promise.all([
      prisma.publicReview.findFirst({ where: { authorId: context.user.id, isSynthetic, status: "PENDING" }, select: { id: true } }),
      prisma.publicReview.count({ where: { authorId: context.user.id, createdAt: { gte: since } } }),
      prisma.publicReview.findFirst({ where: { authorId: context.user.id, body: parsed.data.body, createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } }, select: { id: true } }),
    ]);
    if (pending) return reply.code(409).send({ error: "Ваш отзыв уже ожидает проверки" });
    if (recentCount >= 1) return reply.code(429).send({ error: "Новый отзыв можно отправить через сутки" });
    if (duplicate) return reply.code(409).send({ error: "Такой отзыв уже отправлялся" });
    const review = await prisma.publicReview.create({ data: { authorId: context.user.id, rating: parsed.data.rating, body: parsed.data.body, isSynthetic } });
    return reply.code(201).send({ ok: true, status: review.status });
  });

  app.get("/api/owner/reviews", async (request, reply) => {
    const context = await requireRole(request, reply, ["PROJECT_OWNER"]);
    if (!context) return;
    return prisma.publicReview.findMany({ select: reviewSelect, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 200 });
  });

  app.patch<{ Params: { id: string } }>("/api/owner/reviews/:id", async (request, reply) => {
    const context = await requireRole(request, reply, ["PROJECT_OWNER"]);
    if (!context) return;
    const parsed = reviewDecision.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Выберите решение по отзыву" });
    const updated = await prisma.publicReview.updateMany({ where: { id: request.params.id }, data: { status: parsed.data.status, isSynthetic: parsed.data.status === "APPROVED" ? false : undefined, moderatedAt: new Date() } });
    if (!updated.count) return reply.code(404).send({ error: "Отзыв не найден" });
    await prisma.auditLog.create({ data: { actorId: context.user.id, action: parsed.data.status === "APPROVED" ? "REVIEW_APPROVED" : "REVIEW_REJECTED", objectType: "PublicReview", objectId: request.params.id } });
    return prisma.publicReview.findUnique({ where: { id: request.params.id }, select: reviewSelect });
  });
}
