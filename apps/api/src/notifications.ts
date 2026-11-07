import type { Prisma } from "@prisma/client";
import { levelForExp } from "@vibe/shared";
import { prisma } from "./db.js";
import { isMaxEnabled } from "./max-service.js";

export type NotificationKind = "TASKS" | "ORDERS" | "PROGRESS" | "COSMETICS";
export type MaxNotificationCategory = "newTasks" | "deadlines" | "results" | "returns" | "orders" | "system";
const preferenceFor: Record<NotificationKind, "notifyTasks" | "notifyOrders" | "notifyProgress" | "notifyCosmetics"> = {
  TASKS: "notifyTasks", ORDERS: "notifyOrders", PROGRESS: "notifyProgress", COSMETICS: "notifyCosmetics",
};
const maxPreferenceFor: Record<MaxNotificationCategory, "maxNotifyNewTasks" | "maxNotifyDeadlines" | "maxNotifyResults" | "maxNotifyReturns" | "maxNotifyOrders" | "maxNotifySystem"> = {
  newTasks: "maxNotifyNewTasks", deadlines: "maxNotifyDeadlines", results: "maxNotifyResults", returns: "maxNotifyReturns", orders: "maxNotifyOrders", system: "maxNotifySystem",
};
function maxCategory(kind: NotificationKind, title: string): MaxNotificationCategory {
  if (kind === "ORDERS") return "orders";
  if (kind === "PROGRESS" || kind === "COSMETICS") return "system";
  if (title.toLocaleLowerCase("ru-RU").includes("срок")) return "deadlines";
  if (title.toLocaleLowerCase("ru-RU").includes("вернули")) return "returns";
  if (title.toLocaleLowerCase("ru-RU").includes("проверена")) return "results";
  return "newTasks";
}

function localMinute(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  return Number(parts.find((part) => part.type === "hour")?.value ?? 0) * 60 + Number(parts.find((part) => part.type === "minute")?.value ?? 0);
}

function parseMinute(value: string) { const [hour, minute] = value.split(":").map(Number); return hour! * 60 + minute!; }

function isQuiet(date: Date, timezone: string, start: string, end: string) {
  const minute = localMinute(date, timezone); const from = parseMinute(start); const to = parseMinute(end);
  if (from === to) return false;
  return from < to ? minute >= from && minute < to : minute >= from || minute < to;
}

export function nextAllowedNotificationTime(now: Date, timezone: string, enabled: boolean, start: string, end: string) {
  if (!enabled || !isQuiet(now, timezone, start, end)) return now;
  const next = new Date(now);
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() + 1);
  for (let minute = 0; minute < 26 * 60; minute += 1) {
    if (!isQuiet(next, timezone, start, end)) return next;
    next.setMinutes(next.getMinutes() + 1);
  }
  return now;
}

type NotificationInput = { userId: string; eventKey: string; kind: NotificationKind; title: string; body: string; link?: string };

export async function enqueueNotification(input: NotificationInput) {
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: input.userId }, include: { preferences: true, memberships: { where: { active: true, approved: true }, include: { school: { select: { timezone: true } } }, take: 1 } } });
    if (!user) return;
    const preferences = user.preferences;
    if (preferences && !preferences[preferenceFor[input.kind]]) return;
    await tx.notification.upsert({
      where: { eventKey: input.eventKey },
      create: { userId: input.userId, eventKey: input.eventKey, kind: input.kind, title: input.title.slice(0, 160), body: input.body.slice(0, 1000) },
      update: {},
    });
    const transport = process.env.MAX_TRANSPORT === "max" && isMaxEnabled() && process.env.MAX_BOT_TOKEN ? "max" : "mock";
    const maxType = maxCategory(input.kind, input.title);
    if (transport === "max" && (!user.maxUserId || !user.maxBotStartedAt || !preferences?.maxNotificationsEnabled || !preferences[maxPreferenceFor[maxType]])) return;
    const now = new Date(); const timezone = user.memberships[0]?.school.timezone ?? "Europe/Moscow";
    const nextAttemptAt = nextAllowedNotificationTime(now, timezone, preferences?.quietHoursEnabled ?? true, preferences?.quietStart ?? "22:00", preferences?.quietEnd ?? "08:00");
    const taskEvent = input.eventKey.startsWith("task:assigned:") || input.eventKey.startsWith("task:checked:") || input.eventKey.startsWith("task:returned:");
    const payload = { text: `${input.title}\n${input.body}`.slice(0, 4000), ...(taskEvent ? { buttons: [{ type: "open_app", text: "🚀 Открыть Вайб" }] } : input.link ? { link: input.link } : {}), userId: user.id, category: input.kind, maxCategory: maxType };
    await tx.outbox.upsert({
      where: { dedupeKey: `notification:${input.eventKey}` },
      create: { dedupeKey: `notification:${input.eventKey}`, transport, recipient: transport === "max" ? user.maxUserId! : user.maxUserId ?? user.id, body: JSON.stringify(payload), nextAttemptAt },
      update: {},
    });
  });
}

export async function notifyEvent(input: NotificationInput) {
  try { await enqueueNotification(input); } catch (error) { console.error("Не удалось поставить уведомление в очередь:", error instanceof Error ? error.name : "UnknownError"); }
}

export async function notifyLevelUp(userId: string, beforeExp: number, afterExp: number, sourceRef: string, link: string) {
  const oldLevel = levelForExp(beforeExp); const newLevel = levelForExp(afterExp);
  if (newLevel <= oldLevel) return;
  const unlocked = await prisma.cosmeticUnlock.findMany({ where: { userId, sourceRef }, include: { cosmetic: { select: { displayName: true } } } }).catch(() => []);
  const additions = unlocked.map((item) => item.cosmetic.displayName);
  await notifyEvent({
    userId, eventKey: `progress:level:${sourceRef}:${newLevel}`, kind: "PROGRESS", title: `Открыт ${newLevel}-й уровень!`,
    body: `Новый уровень личного пути.${additions.length ? ` Вместе с ним открыто: ${additions.join(", ")}.` : ""}`,
    link,
  });
}

export async function notificationStillAllowed(tx: Prisma.TransactionClient, userId: string, kind: NotificationKind, now: Date, category?: MaxNotificationCategory) {
  const user = await tx.user.findUnique({ where: { id: userId }, include: { preferences: true, memberships: { where: { active: true, approved: true }, include: { school: { select: { timezone: true } } }, take: 1 } } });
  if (!user) return { allowed: false as const, nextAttemptAt: now };
  const preferences = user.preferences;
  if (preferences && !preferences[preferenceFor[kind]]) return { allowed: false as const, nextAttemptAt: now };
  const maxType = category ?? maxCategory(kind, "");
  if (!user.maxUserId || !user.maxBotStartedAt || !preferences?.maxNotificationsEnabled || !preferences[maxPreferenceFor[maxType]]) return { allowed: false as const, nextAttemptAt: now };
  const timezone = user.memberships[0]?.school.timezone ?? "Europe/Moscow";
  const nextAttemptAt = nextAllowedNotificationTime(now, timezone, preferences?.quietHoursEnabled ?? true, preferences?.quietStart ?? "22:00", preferences?.quietEnd ?? "08:00");
  return { allowed: nextAttemptAt.getTime() <= now.getTime(), nextAttemptAt };
}
