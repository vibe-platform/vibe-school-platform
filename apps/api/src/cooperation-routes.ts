import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { prisma } from "./db.js";
import { requireRole } from "./security.js";

const mediaSchema = z.object({
  imageAttachmentId: z.string().trim().min(1).max(80),
  type: z.enum(["MEETING", "CONTRACT", "LOCATION", "LOGO", "COVER"]),
  caption: z.string().trim().max(240),
}).strict();

const partnerInput = z.object({
  name: z.string().trim().min(1, "Укажите название организации").max(150),
  category: z.string().trim().max(100).nullable(),
  city: z.string().trim().max(100).nullable(),
  shortDescription: z.string().trim().max(1200),
  mapUrl: z.string().trim().max(1000).nullable(),
  isPublished: z.boolean(),
  sortOrder: z.number().int().min(0).max(10000),
  media: z.array(mediaSchema).max(60),
}).strict();

const partnerInclude = { media: { include: { image: { select: { id: true } } }, orderBy: [{ type: "asc" as const }, { sortOrder: "asc" as const }] } };
type PartnerRecord = Prisma.CooperationPartnerGetPayload<{ include: typeof partnerInclude }>;
const imageUrl = (id: string) => `/api/about/images/${encodeURIComponent(id)}`;
const uploadDir = () => resolve(process.cwd(), process.env.UPLOAD_DIR ?? "./data/uploads");

function yandexMapsUrl(value: string | null) {
  if (!value) return true;
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  const host = url.hostname.toLowerCase();
  return url.protocol === "https:" && (host === "yandex.ru" || host.endsWith(".yandex.ru") || host === "yandex.com" || host.endsWith(".yandex.com")) && url.pathname.startsWith("/maps");
}

function dto(partner: PartnerRecord) {
  return {
    id: partner.id,
    name: partner.name,
    category: partner.category,
    city: partner.city,
    shortDescription: partner.shortDescription,
    mapUrl: partner.mapUrl,
    isPublished: partner.isPublished,
    sortOrder: partner.sortOrder,
    archivedAt: partner.archivedAt,
    updatedAt: partner.updatedAt,
    media: partner.media.map((item) => ({ id: item.id, imageAttachmentId: item.imageAttachmentId, type: item.type, caption: item.caption, sortOrder: item.sortOrder, imageUrl: imageUrl(item.imageAttachmentId) })),
  };
}

export async function registerCooperationRoutes(app: FastifyInstance) {
  app.get("/api/partners", async (_request) => {
    const rows = await prisma.cooperationPartner.findMany({
      where: {
        isSynthetic: false,
        archivedAt: null,
        isPublished: true,
      },
      include: partnerInclude,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    });
    return rows.map(dto);
  });

  app.get("/api/owner/partners", async (request, reply) => {
    const context = await requireRole(request, reply, ["PROJECT_OWNER"]);
    if (!context) return;
    const rows = await prisma.cooperationPartner.findMany({
      where: {},
      include: partnerInclude,
      orderBy: [{ archivedAt: "asc" }, { sortOrder: "asc" }, { updatedAt: "desc" }],
    });
    return rows.map(dto);
  });

  app.post("/api/owner/partners", async (request, reply) => {
    const context = await requireRole(request, reply, ["PROJECT_OWNER"]);
    if (!context) return;
    const parsed = partnerInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Проверьте данные точки сотрудничества" });
    const input = parsed.data;
    if (!yandexMapsUrl(input.mapUrl)) return reply.code(400).send({ error: "Укажите HTTPS-ссылку на место в Яндекс Картах" });
    if (input.isPublished && !input.shortDescription) return reply.code(400).send({ error: "Добавьте описание перед публикацией" });
    const ids = input.media.map((item) => item.imageAttachmentId);
    if (new Set(ids).size !== ids.length) return reply.code(400).send({ error: "Одно фото нельзя прикрепить несколько раз" });
    if (ids.length) {
      const images = await prisma.aboutImage.findMany({ where: { id: { in: ids } }, select: { id: true } });
      if (images.length !== ids.length) return reply.code(400).send({ error: "Можно прикрепить только загруженные владельцем фотографии" });
    }
    const partner = await prisma.$transaction(async (tx) => {
      const created = await tx.cooperationPartner.create({ data: {
        name: input.name, category: input.category || null, city: input.city || null,
        shortDescription: input.shortDescription, mapUrl: input.mapUrl || null, isPublished: input.isPublished,
        isSynthetic: false, sortOrder: input.sortOrder, updatedById: context.user.id,
      } });
      if (input.media.length) await tx.cooperationMedia.createMany({ data: input.media.map((item, sortOrder) => ({ partnerId: created.id, imageAttachmentId: item.imageAttachmentId, type: item.type, caption: item.caption, sortOrder })) });
      return tx.cooperationPartner.findUniqueOrThrow({ where: { id: created.id }, include: partnerInclude });
    });
    return reply.code(201).send(dto(partner));
  });

  app.patch<{ Params: { id: string } }>("/api/owner/partners/:id", async (request, reply) => {
    const context = await requireRole(request, reply, ["PROJECT_OWNER"]);
    if (!context) return;
    const current = await prisma.cooperationPartner.findUnique({ where: { id: request.params.id } });
    if (!current || current.archivedAt) return reply.code(404).send({ error: "Точка сотрудничества не найдена" });
    const parsed = partnerInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Проверьте данные точки сотрудничества" });
    const input = parsed.data;
    if (!yandexMapsUrl(input.mapUrl)) return reply.code(400).send({ error: "Укажите HTTPS-ссылку на место в Яндекс Картах" });
    if (input.isPublished && !input.shortDescription) return reply.code(400).send({ error: "Добавьте описание перед публикацией" });
    const ids = input.media.map((item) => item.imageAttachmentId);
    if (new Set(ids).size !== ids.length) return reply.code(400).send({ error: "Одно фото нельзя прикрепить несколько раз" });
    const existingMedia = await prisma.cooperationMedia.findMany({ where: { partnerId: current.id }, select: { imageAttachmentId: true } });
    const existingIds = new Set(existingMedia.map((item) => item.imageAttachmentId));
    if (ids.length) {
      const images = await prisma.aboutImage.findMany({ where: { id: { in: ids } }, select: { id: true } });
      if (images.length !== ids.length) return reply.code(400).send({ error: "Можно прикрепить только загруженные владельцем фотографии" });
      if (ids.some((id) => existingIds.has(id) && !images.some((image) => image.id === id))) return reply.code(400).send({ error: "Фото больше не доступно владельцу этой точки" });
    }
    const saved = await prisma.$transaction(async (tx) => {
      await tx.cooperationMedia.deleteMany({ where: { partnerId: current.id } });
      await tx.cooperationPartner.update({ where: { id: current.id }, data: {
        name: input.name, category: input.category || null, city: input.city || null,
        shortDescription: input.shortDescription, mapUrl: input.mapUrl || null, isPublished: input.isPublished,
        sortOrder: input.sortOrder, updatedById: context.user.id, isSynthetic: false,
      } });
      if (input.media.length) await tx.cooperationMedia.createMany({ data: input.media.map((item, sortOrder) => ({ partnerId: current.id, imageAttachmentId: item.imageAttachmentId, type: item.type, caption: item.caption, sortOrder })) });
      return tx.cooperationPartner.findUniqueOrThrow({ where: { id: current.id }, include: partnerInclude });
    });
    const removedIds = existingMedia.map((item) => item.imageAttachmentId).filter((id) => !ids.includes(id));
    for (const id of removedIds) {
      const unused = await prisma.aboutImage.findFirst({ where: { id, teamMembers: { none: {} }, sections: { none: {} }, cooperationMedia: { is: null } }, select: { id: true, fileName: true } });
      if (unused) {
        await prisma.aboutImage.delete({ where: { id: unused.id } }).catch(() => undefined);
        await unlink(resolve(uploadDir(), unused.fileName)).catch(() => undefined);
      }
    }
    return dto(saved);
  });

  app.post<{ Params: { id: string } }>("/api/owner/partners/:id/archive", async (request, reply) => {
    const context = await requireRole(request, reply, ["PROJECT_OWNER"]);
    if (!context) return;
    const partner = await prisma.cooperationPartner.findFirst({ where: { id: request.params.id, archivedAt: null }, select: { id: true } });
    if (!partner) return reply.code(404).send({ error: "Точка сотрудничества не найдена" });
    await prisma.cooperationPartner.update({ where: { id: partner.id }, data: { archivedAt: new Date(), isPublished: false, updatedById: context.user.id } });
    return { ok: true, archived: true };
  });

  app.post<{ Params: { id: string } }>("/api/owner/partners/:id/order", async (request, reply) => {
    const context = await requireRole(request, reply, ["PROJECT_OWNER"]);
    if (!context) return;
    const parsed = z.object({ direction: z.enum(["UP", "DOWN"]) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Выберите новое положение карточки" });
    const current = await prisma.cooperationPartner.findFirst({ where: { id: request.params.id, archivedAt: null }, select: { id: true, sortOrder: true } });
    if (!current) return reply.code(404).send({ error: "Точка сотрудничества не найдена" });
    const active = await prisma.cooperationPartner.findMany({ where: { archivedAt: null }, select: { id: true, sortOrder: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }] });
    const index = active.findIndex((item) => item.id === current.id);
    const targetIndex = index + (parsed.data.direction === "UP" ? -1 : 1);
    if (index < 0 || targetIndex < 0 || targetIndex >= active.length) return { ok: true, unchanged: true };
    const target = active[targetIndex]!;
    await prisma.$transaction([
      prisma.cooperationPartner.update({ where: { id: current.id }, data: { sortOrder: target.sortOrder, updatedById: context.user.id } }),
      prisma.cooperationPartner.update({ where: { id: target.id }, data: { sortOrder: current.sortOrder, updatedById: context.user.id } }),
    ]);
    return { ok: true };
  });
}
