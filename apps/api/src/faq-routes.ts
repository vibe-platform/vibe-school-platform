import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "./db.js";
import { requireRole } from "./security.js";

const faqInput = z.object({
  question: z.string().trim().min(5, "Добавьте понятный вопрос").max(240, "Вопрос должен быть короче 240 символов"),
  answer: z.string().trim().min(2, "Добавьте ответ").max(12_000, "Ответ должен быть короче 12 000 символов"),
  category: z.string().trim().min(1).max(80),
  isFeatured: z.boolean(),
  isPublished: z.boolean(),
  sortOrder: z.number().int().min(-100_000).max(100_000),
}).strict();
const faqPatch = faqInput.partial().strict().refine((value) => Object.keys(value).length > 0, "Укажите хотя бы одно поле");

export async function registerFaqRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { q?: string; category?: string } }>("/api/faq", async (request) => {
    const q = request.query.q?.trim().slice(0, 120);
    const category = request.query.category?.trim().slice(0, 80);
    const rows = await prisma.faqItem.findMany({
      where: { isSynthetic: false, isPublished: true, archivedAt: null, ...(category ? { category } : {}), ...(q ? { OR: [{ question: { contains: q } }, { answer: { contains: q } }] } : {}) },
      orderBy: [{ isFeatured: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, question: true, answer: true, category: true, isFeatured: true, sortOrder: true, updatedAt: true },
    });
    return { items: rows, categories: [...new Set(rows.map((row) => row.category))] };
  });

  app.get("/api/owner/faq", async (request, reply) => {
    const context = await requireRole(request, reply, ["PROJECT_OWNER"]);
    if (!context) return;
    return prisma.faqItem.findMany({ orderBy: [{ archivedAt: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }] });
  });

  app.post("/api/owner/faq", async (request, reply) => {
    const context = await requireRole(request, reply, ["PROJECT_OWNER"]);
    if (!context) return;
    const parsed = faqInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Проверьте поля вопроса" });
    const item = await prisma.faqItem.create({ data: { ...parsed.data, isSynthetic: false } });
    return reply.code(201).send(item);
  });

  app.put<{ Params: { id: string } }>("/api/owner/faq/:id", async (request, reply) => {
    const context = await requireRole(request, reply, ["PROJECT_OWNER"]);
    if (!context) return;
    const parsed = faqInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Проверьте поля вопроса" });
    const updated = await prisma.faqItem.updateMany({ where: { id: request.params.id, archivedAt: null }, data: { ...parsed.data, isSynthetic: false } });
    if (!updated.count) return reply.code(404).send({ error: "Вопрос не найден или уже находится в архиве" });
    return prisma.faqItem.findUnique({ where: { id: request.params.id } });
  });

  app.patch<{ Params: { id: string } }>("/api/owner/faq/:id", async (request, reply) => {
    const context = await requireRole(request, reply, ["PROJECT_OWNER"]);
    if (!context) return;
    const parsed = faqPatch.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Проверьте изменения" });
    const updated = await prisma.faqItem.updateMany({ where: { id: request.params.id, archivedAt: null }, data: { ...parsed.data, isSynthetic: false } });
    if (!updated.count) return reply.code(404).send({ error: "Вопрос не найден или уже находится в архиве" });
    return prisma.faqItem.findUnique({ where: { id: request.params.id } });
  });

  app.post<{ Params: { id: string } }>("/api/owner/faq/:id/archive", async (request, reply) => {
    const context = await requireRole(request, reply, ["PROJECT_OWNER"]);
    if (!context) return;
    const result = await prisma.faqItem.updateMany({ where: { id: request.params.id, archivedAt: null }, data: { archivedAt: new Date(), isPublished: false, isSynthetic: false } });
    if (!result.count) return reply.code(404).send({ error: "Вопрос не найден или уже архивирован" });
    return { ok: true, archived: true };
  });

  app.post<{ Params: { id: string } }>("/api/owner/faq/:id/restore", async (request, reply) => {
    const context = await requireRole(request, reply, ["PROJECT_OWNER"]);
    if (!context) return;
    const result = await prisma.faqItem.updateMany({ where: { id: request.params.id, archivedAt: { not: null } }, data: { archivedAt: null, isPublished: false, isSynthetic: false } });
    if (!result.count) return reply.code(404).send({ error: "Архивный вопрос не найден" });
    return { ok: true, restored: true };
  });

  app.put("/api/owner/faq-order", async (request, reply) => {
    const context = await requireRole(request, reply, ["PROJECT_OWNER"]);
    if (!context) return;
    const parsed = z.object({ ids: z.array(z.string().min(1)).max(500) }).strict().safeParse(request.body);
    if (!parsed.success || new Set(parsed.data?.ids ?? []).size !== parsed.data?.ids.length) return reply.code(400).send({ error: "Список порядка содержит повтор или неверные данные" });
    const ids = parsed.data.ids;
    const active = await prisma.faqItem.findMany({ where: { id: { in: ids }, archivedAt: null }, select: { id: true } });
    if (active.length !== ids.length) return reply.code(409).send({ error: "Список изменился. Обновите страницу и повторите сортировку." });
    await prisma.$transaction(ids.map((id, sortOrder) => prisma.faqItem.updateMany({ where: { id }, data: { sortOrder, isSynthetic: false } })));
    return { ok: true };
  });
}
