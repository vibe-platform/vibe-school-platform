import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "./db.js";
import { requireAuth, requireRole } from "./security.js";
import { notifyEvent } from "./notifications.js";
import { displayUserName } from "./display-name.js";

class MarketError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }

async function visibleProduct(productId: string, schoolId: string | undefined) {
  return prisma.product.findFirst({ where: { id: productId, OR: [
    // Every global product is part of the owner-curated public catalogue.
    { scope: "GLOBAL" },
    ...(schoolId ? [{ scope: "SCHOOL" as const, schoolId }] : []),
  ] } });
}

export async function registerMarketRoutes(app: FastifyInstance) {
  app.get("/api/market", async (request, reply) => {
    const context = await requireAuth(request, reply);
    if (!context) return;
    const membership = context.membership;
    const [products, favorites, savings, orders] = await Promise.all([
      prisma.product.findMany({ where: { OR: [
        { scope: "GLOBAL" },
        ...(membership ? [{ scope: "SCHOOL" as const, schoolId: membership.schoolId }] : []),
      ] }, include: { image: { select: { id: true } } }, orderBy: [{ scope: "asc" }, { name: "asc" }] }),
      membership ? prisma.favoriteProduct.findMany({ where: { membershipId: membership.id }, select: { productId: true } }) : [],
      membership ? prisma.savingsGoal.findUnique({ where: { membershipId: membership.id }, include: { product: { include: { image: { select: { id: true } } } } } }) : null,
      membership ? prisma.order.findMany({ where: { membershipId: membership.id }, include: { product: { select: { id: true, imageKey: true, category: true, image: { select: { id: true } } } } }, orderBy: { createdAt: "desc" }, take: 10 }) : [],
    ]);
    const favoriteIds = new Set(favorites.map((favorite) => favorite.productId));
    return {
      products: products.map(({ image, ...product }) => ({ ...product, favorite: favoriteIds.has(product.id), available: product.active && product.stock > 0, imageUrl: image ? `/api/market/products/${product.id}/image` : `/assets/products/${product.imageKey}` })),
      favorites: favorites.map((favorite) => favorite.productId),
      savingsGoal: savings ? {
        product: { id: savings.product.id, name: savings.product.name, price: savings.product.price, imageKey: savings.product.imageKey, imageUrl: savings.product.image ? `/api/market/products/${savings.product.id}/image` : `/assets/products/${savings.product.imageKey}`, active: savings.product.active, stock: savings.product.stock },
        balance: membership?.balance ?? 0,
        remaining: Math.max(0, savings.product.price - (membership?.balance ?? 0)),
        progress: Math.min(100, Math.round((membership?.balance ?? 0) / Math.max(1, savings.product.price) * 100)),
      } : null,
      orders: orders.map((order) => ({ id: order.id, code: order.code, name: order.nameSnapshot, price: order.priceSnapshot, status: order.status, createdAt: order.createdAt, imageKey: order.product.imageKey, imageUrl: order.product.image ? `/api/market/products/${order.product.id}/image` : `/assets/products/${order.product.imageKey}` })),
      balance: membership?.balance ?? 0,
      membershipRole: membership?.role ?? null,
    };
  });

  app.put("/api/market/favorites", async (request, reply) => {
    const context = await requireAuth(request, reply);
    if (!context) return;
    if (!context.membership) return reply.code(403).send({ error: "Избранное привязано к школьной принадлежности" });
    const parsed = z.object({ productId: z.string(), favorite: z.boolean() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Выберите товар и действие" });
    const product = await visibleProduct(parsed.data.productId, context.membership.schoolId);
    if (!product || !product.active) return reply.code(404).send({ error: "Товар недоступен в вашей школе" });
    if (parsed.data.favorite) await prisma.favoriteProduct.upsert({ where: { membershipId_productId: { membershipId: context.membership.id, productId: product.id } }, create: { membershipId: context.membership.id, productId: product.id }, update: {} });
    else await prisma.favoriteProduct.deleteMany({ where: { membershipId: context.membership.id, productId: product.id } });
    return { ok: true, favorite: parsed.data.favorite };
  });

  app.put("/api/market/savings-goal", async (request, reply) => {
    const context = await requireAuth(request, reply);
    if (!context) return;
    if (!context.membership) return reply.code(403).send({ error: "Цель накопления привязана к школьной принадлежности" });
    const parsed = z.object({ productId: z.string().nullable() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Проверьте выбранный товар" });
    if (parsed.data.productId === null) {
      await prisma.savingsGoal.deleteMany({ where: { membershipId: context.membership.id } });
      return { ok: true, savingsGoal: null };
    }
    const product = await visibleProduct(parsed.data.productId, context.membership.schoolId);
    if (!product || !product.active) return reply.code(404).send({ error: "Этот товар не принадлежит доступному вам каталогу" });
    const goal = await prisma.savingsGoal.upsert({ where: { membershipId: context.membership.id }, create: { membershipId: context.membership.id, productId: product.id }, update: { productId: product.id } });
    return { ok: true, savingsGoal: goal };
  });

  app.post("/api/market/purchase", async (request, reply) => {
    const context = await requireRole(request, reply, ["STUDENT"]);
    if (!context) return;
    if (!context.membership || context.membership.role !== "STUDENT") return reply.code(403).send({ error: "Покупки доступны ученикам с подтверждённой принадлежностью" });
    const parsed = z.object({ productId: z.string(), idempotencyKey: z.string().min(12).max(100) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Обновите страницу и повторите покупку" });
    try {
      const order = await prisma.$transaction(async (tx) => {
        const previous = await tx.order.findUnique({ where: { idempotencyKey: parsed.data.idempotencyKey } });
        if (previous) {
          if (previous.membershipId !== context.membership!.id) throw new MarketError("Ключ операции уже использован", 409);
          return previous;
        }
        const product = await tx.product.findFirst({ where: { id: parsed.data.productId, active: true, OR: [
          { scope: "GLOBAL" },
          { scope: "SCHOOL", schoolId: context.membership!.schoolId },
        ] } });
        if (!product) throw new MarketError("Товар не найден в доступном каталоге", 404);
        const priorCount = await tx.order.count({ where: { membershipId: context.membership!.id, productId: product.id, status: { in: ["RESERVED", "FULFILLED"] } } });
        if (priorCount >= product.perUserLimit) throw new MarketError("Вы уже использовали лимит этого товара", 409);
        const stock = await tx.product.updateMany({ where: { id: product.id, active: true, stock: { gt: 0 } }, data: { stock: { decrement: 1 } } });
        if (stock.count !== 1) throw new MarketError("Товар закончился", 409);
        const charged = await tx.membership.updateMany({ where: { id: context.membership!.id, active: true, approved: true, balance: { gte: product.price } }, data: { balance: { decrement: product.price } } });
        if (charged.count !== 1) throw new MarketError("Не хватает Эйнштейнов для покупки", 409);
        const updatedMembership = await tx.membership.findUniqueOrThrow({ where: { id: context.membership!.id } });
        const id = `purchase:${parsed.data.idempotencyKey}`;
        const created = await tx.order.create({ data: {
          idempotencyKey: parsed.data.idempotencyKey, code: `VIB-${randomBytes(5).toString("hex").toUpperCase()}`,
          membershipId: context.membership!.id, productId: product.id, nameSnapshot: product.name,
          priceSnapshot: product.price, termsSnapshot: product.description,
        } });
        await tx.ledgerEntry.create({ data: { membershipId: context.membership!.id, kind: "PURCHASE", amount: -product.price, balanceAfter: updatedMembership.balance, totalExpAfter: updatedMembership.totalExp, referenceId: created.id, idempotencyKey: id, note: `Покупка: ${product.name}` } });
        return created;
      });
      await notifyEvent({ userId: context.user.id, eventKey: `order:reserved:${order.id}`, kind: "ORDERS", title: "Заказ оформлен", body: `«${order.nameSnapshot}» · код ${order.code}. Сохраните код для получения.`, link: `${process.env.PUBLIC_APP_URL ?? "http://127.0.0.1:5173"}/market` });
      return reply.code(201).send({ ok: true, order: { id: order.id, code: order.code, name: order.nameSnapshot, price: order.priceSnapshot, status: order.status } });
    } catch (error) {
      if (error instanceof MarketError) return reply.code(error.status).send({ error: error.message });
      request.log.error({ err: error }, "Purchase failed");
      return reply.code(409).send({ error: "Покупка не прошла. Обновите баланс и остаток товара." });
    }
  });

  app.post<{ Params: { id: string } }>("/api/market/orders/:id/cancel", async (request, reply) => {
    const context = await requireAuth(request, reply);
    if (!context) return;
    if (!context.membership) return reply.code(404).send({ error: "Заказ не найден" });
    try {
      const order = await prisma.$transaction(async (tx) => {
        const owned = await tx.order.findFirst({ where: { id: request.params.id, membershipId: context.membership!.id } });
        if (!owned) throw new MarketError("Заказ не найден", 404);
        if (owned.status === "CANCELLED") return owned;
        if (owned.status !== "RESERVED") throw new MarketError("Выданный заказ нельзя отменить обычным способом", 409);
        const changed = await tx.order.updateMany({ where: { id: owned.id, status: "RESERVED" }, data: { status: "CANCELLED" } });
        if (changed.count !== 1) throw new MarketError("Заказ уже изменён", 409);
        await tx.product.update({ where: { id: owned.productId }, data: { stock: { increment: 1 } } });
        const balance = await tx.membership.update({ where: { id: owned.membershipId }, data: { balance: { increment: owned.priceSnapshot } } });
        await tx.ledgerEntry.create({ data: { membershipId: owned.membershipId, kind: "REFUND", amount: owned.priceSnapshot, balanceAfter: balance.balance, totalExpAfter: balance.totalExp, referenceId: owned.id, idempotencyKey: `refund:${owned.id}`, note: `Возврат: ${owned.nameSnapshot}` } });
        return tx.order.findUniqueOrThrow({ where: { id: owned.id } });
      });
      if (order.status === "CANCELLED") await notifyEvent({ userId: context.user.id, eventKey: `order:cancelled:${order.id}`, kind: "ORDERS", title: "Заказ отменён", body: `Баланс и остаток товара восстановлены для «${order.nameSnapshot}».`, link: `${process.env.PUBLIC_APP_URL ?? "http://127.0.0.1:5173"}/market` });
      return { ok: true, status: order.status };
    } catch (error) {
      if (error instanceof MarketError) return reply.code(error.status).send({ error: error.message });
      request.log.error({ err: error }, "Order cancellation failed");
      return reply.code(409).send({ error: "Не удалось отменить заказ" });
    }
  });

  app.get("/api/admin/orders", async (request, reply) => {
    const context = await requireRole(request, reply, ["SCHOOL_ADMIN", "PROJECT_OWNER"]);
    if (!context) return;
    const isOwner = context.user.platformRole === "PROJECT_OWNER";
    const rows = await prisma.order.findMany({ where: isOwner ? { product: { scope: "GLOBAL" } } : { product: { scope: "SCHOOL", schoolId: context.membership?.schoolId } }, include: { product: { select: { scope: true, schoolId: true, isSynthetic: true } }, membership: { include: { user: { select: { displayName: true, firstName: true, lastName: true, username: true } }, schoolClass: { select: { name: true } } } } }, orderBy: { createdAt: "desc" }, take: 100 });
    return rows.map((order) => ({ id: order.id, code: order.code, name: order.nameSnapshot, price: order.priceSnapshot, status: order.status, createdAt: order.createdAt, student: { name: displayUserName(order.membership.user), className: order.membership.schoolClass?.name ?? "" } }));
  });

  app.post<{ Params: { id: string } }>("/api/admin/orders/:id/fulfill", async (request, reply) => {
    const context = await requireRole(request, reply, ["SCHOOL_ADMIN", "PROJECT_OWNER"]);
    if (!context) return;
    const order = await prisma.order.findUnique({ where: { id: request.params.id }, include: { product: true } });
    if (!order || order.status !== "RESERVED") return reply.code(404).send({ error: "Активный заказ не найден" });
    const isOwner = context.user.platformRole === "PROJECT_OWNER";
    const inScope = isOwner ? order.product.scope === "GLOBAL" : order.product.scope === "SCHOOL" && order.product.schoolId === context.membership?.schoolId;
    if (!inScope) return reply.code(403).send({ error: "Этот заказ относится к другому каталогу" });
    const changed = await prisma.order.updateMany({ where: { id: order.id, status: "RESERVED" }, data: { status: "FULFILLED" } });
    if (!changed.count) return reply.code(409).send({ error: "Заказ уже обработан" });
    const owner = await prisma.membership.findUnique({ where: { id: order.membershipId }, select: { userId: true } });
    if (owner) await notifyEvent({ userId: owner.userId, eventKey: `order:fulfilled:${order.id}`, kind: "ORDERS", title: "Заказ готов", body: `«${order.nameSnapshot}» можно получить. Код: ${order.code}.`, link: `${process.env.PUBLIC_APP_URL ?? "http://127.0.0.1:5173"}/market` });
    return { ok: true, status: "FULFILLED" };
  });
}
