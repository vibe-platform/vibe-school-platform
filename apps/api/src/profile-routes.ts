import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { expProgress, levelForExp, mondayWeekKey } from "@vibe/shared";
import { prisma } from "./db.js";
import { authenticate, requireAuth } from "./security.js";
import { mondayOfWeek, pendingActivityDayKeys } from "./dates.js";
import { displayUserName } from "./display-name.js";

const appearanceSchema = z.object({
  background: z.string().min(1), emoji: z.string().min(1), frame: z.string().min(1), title: z.string().min(1), pattern: z.string().min(1),
});
const preferencesSchema = z.object({
  reduceTransparency: z.boolean().optional(), reduceMotion: z.boolean().optional(), highContrast: z.boolean().optional(), focusMode: z.boolean().optional(),
  notifyTasks: z.boolean().optional(), notifyOrders: z.boolean().optional(), notifyProgress: z.boolean().optional(), notifyCosmetics: z.boolean().optional(),
  maxNotificationsEnabled: z.boolean().optional(), maxNotifyNewTasks: z.boolean().optional(), maxNotifyDeadlines: z.boolean().optional(),
  maxNotifyResults: z.boolean().optional(), maxNotifyReturns: z.boolean().optional(), maxNotifyOrders: z.boolean().optional(), maxNotifySystem: z.boolean().optional(),
  quietHoursEnabled: z.boolean().optional(), quietStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u).optional(), quietEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u).optional(),
}).strict();
type AppearanceValues = { background: string; emoji: string; frame: string; title: string; pattern: string };
const appearanceDto = (row: AppearanceValues | null) => row ? ({ background: row.background, emoji: row.emoji, frame: row.frame, title: row.title, pattern: row.pattern }) : null;

const meDto = (user: NonNullable<Awaited<ReturnType<typeof authenticate>>>["user"], membership: NonNullable<Awaited<ReturnType<typeof authenticate>>>["membership"]) => ({
  id: user.id,
  name: displayUserName(user),
  firstName: user.firstName,
  lastName: user.lastName,
  middleName: user.middleName,
  username: user.username,
  avatarUrl: user.avatarUrl,
  maxConnection: {
    connected: Boolean(user.maxUserId),
    username: user.maxUsername,
    firstName: user.maxFirstName,
    lastName: user.maxLastName,
    avatarUrl: user.maxAvatarUrl,
    fullAvatarUrl: user.maxFullAvatarUrl,
    linkedAt: user.maxLinkedAt,
    lastSyncedAt: user.maxLastSyncAt,
    botStarted: Boolean(user.maxBotStartedAt),
  },
  platformRole: user.platformRole,
  role: user.platformRole === "PROJECT_OWNER" ? "PROJECT_OWNER" : membership?.role ?? null,
  isTeacher: Boolean(membership?.isTeacher || membership?.role === "TEACHER" || membership?.isSchoolAdmin || membership?.role === "SCHOOL_ADMIN"),
  isSchoolAdmin: Boolean(membership?.isSchoolAdmin || membership?.role === "SCHOOL_ADMIN"),
  membershipId: membership?.id ?? null,
  school: membership ? { id: membership.schoolId, name: undefined, classId: membership.classId } : null,
  balance: membership?.balance ?? 0,
  totalExp: membership?.totalExp ?? 0,
  level: levelForExp(membership?.totalExp ?? 0),
});

export async function registerProfileRoutes(app: FastifyInstance) {
  app.get("/api/session/me", async (request) => {
    const context = await authenticate(request);
    if (!context) return { authenticated: false };
    const [appearance, preferences, school, schoolClass] = await Promise.all([
      prisma.profileAppearance.findUnique({ where: { userId: context.user.id } }),
      prisma.userPreferences.findUnique({ where: { userId: context.user.id } }),
      context.membership ? prisma.school.findUnique({ where: { id: context.membership.schoolId }, select: { id: true, name: true, city: true, timezone: true } }) : null,
      context.membership?.classId ? prisma.schoolClass.findUnique({ where: { id: context.membership.classId }, select: { id: true, name: true } }) : null,
    ]);
    return {
      authenticated: true,
      authSource: context.authSource,
      user: { ...meDto(context.user, context.membership), school, class: schoolClass, appearance: appearanceDto(appearance), preferences },
    };
  });

  app.get("/api/profile", async (request, reply) => {
    const context = await requireAuth(request, reply);
    if (!context) return;
    const membership = context.membership;
    const [appearance, prefs, latestLedger, submissions, achievements, pins, goals, allDays, pendingSubmissions, school] = await Promise.all([
      prisma.profileAppearance.findUnique({ where: { userId: context.user.id } }),
      prisma.userPreferences.findUnique({ where: { userId: context.user.id } }),
      membership ? prisma.ledgerEntry.findMany({ where: { membershipId: membership.id }, orderBy: { createdAt: "desc" }, take: 12 }) : [],
      membership ? prisma.submission.findMany({ where: { membershipId: membership.id }, include: { assignment: { select: { id: true, title: true, subject: true, category: true } }, answers: { include: { question: { select: { prompt: true } } } } }, orderBy: { updatedAt: "desc" }, take: 20 }) : [],
      membership ? prisma.achievement.findMany({ where: { membershipId: membership.id }, orderBy: { awardedAt: "asc" } }) : [],
      membership ? prisma.pinnedAchievement.findMany({ where: { userId: context.user.id, achievement: { membershipId: membership.id } }, include: { achievement: true }, orderBy: { position: "asc" } }) : [],
      membership ? prisma.weeklyGoal.findMany({ where: { membershipId: membership.id }, orderBy: { weekStart: "desc" }, take: 4 }) : [],
      membership ? prisma.activityDay.findMany({ where: { membershipId: membership.id }, select: { dayKey: true }, orderBy: { dayKey: "desc" } }) : [],
      membership ? prisma.submission.findMany({ where: { membershipId: membership.id, status: "SUBMITTED", submittedAt: { not: null } }, select: { submittedAt: true } }) : [],
      membership ? prisma.school.findUnique({ where: { id: membership.schoolId }, select: { id: true, name: true, city: true, timezone: true } }) : null,
    ]);
    const activeDays = allDays.map((day) => day.dayKey);
    const timezone = school?.timezone ?? "Europe/Moscow";
    const pendingActivityDays = pendingActivityDayKeys(pendingSubmissions.map((submission) => submission.submittedAt), new Set(activeDays), timezone);
    const today = membership ? new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()) : "";
    let currentStreak = 0;
    if (activeDays.length) {
      const cursor = new Date(`${activeDays[0]}T00:00:00Z`);
      for (const key of activeDays) {
        if (key !== cursor.toISOString().slice(0, 10)) break;
        currentStreak += 1;
        cursor.setUTCDate(cursor.getUTCDate() - 1);
      }
      const yesterday = new Date(`${today}T00:00:00Z`); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      if (activeDays[0] !== today && activeDays[0] !== yesterday.toISOString().slice(0, 10)) currentStreak = 0;
    }
    const longestStreak = (() => {
      let best = 0; let run = 0; let prior: string | null = null;
      for (const key of [...activeDays].sort()) {
        const date = new Date(`${key}T00:00:00Z`);
        if (prior && (date.getTime() - Date.parse(`${prior}T00:00:00Z`)) === 86_400_000) run += 1; else run = 1;
        best = Math.max(best, run); prior = key;
      }
      return best;
    })();
    const count = submissions.filter((submission) => submission.status === "COMPLETED").length;
    const progress = expProgress(membership?.totalExp ?? 0);
    const currentWeek = school ? mondayOfWeek(new Date(), school.timezone) : mondayWeekKey(new Date());
    const activeGoal = goals.find((goal) => goal.weekStart === currentWeek && goal.enabled);
    const weekEnd = new Date(`${currentWeek}T00:00:00Z`); weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
    const inWeek = submissions.filter((submission) => submission.submittedAt && submission.submittedAt >= new Date(`${currentWeek}T00:00:00Z`) && submission.submittedAt < weekEnd);
    return {
      user: { ...meDto(context.user, membership), school, class: membership?.classId ? await prisma.schoolClass.findUnique({ where: { id: membership.classId }, select: { id: true, name: true } }) : null },
      appearance: appearanceDto(appearance),
      preferences: prefs,
      progress,
      streak: { current: currentStreak, best: longestStreak, activeDays: activeDays.slice(0, 120) },
      completedCount: count,
      submissions: submissions.map((row) => ({ id: row.id, title: row.assignment.title, subject: row.assignment.subject, category: row.assignment.category, status: row.status, grade: row.grade, earnedPoints: row.earnedPoints, maxPoints: row.maxPoints, submittedAt: row.submittedAt, teacherComment: row.teacherComment })),
      ledger: latestLedger.map((row) => ({ id: row.id, kind: row.kind, amount: row.amount, expAmount: row.expAmount, note: row.note, createdAt: row.createdAt, balanceAfter: row.balanceAfter })),
      achievements: achievements.map(({ id, slug, name, awardedAt }) => ({ id, slug, name, awardedAt, pinned: pins.some((pin) => pin.achievementId === id) })),
      pinnedAchievements: pins.map((pin) => ({ id: pin.achievement.id, slug: pin.achievement.slug, name: pin.achievement.name, position: pin.position })),
      weeklyGoal: activeGoal ? { id: activeGoal.id, target: activeGoal.target, confirmed: inWeek.filter((row) => row.status === "COMPLETED").length, pending: inWeek.filter((row) => row.status === "SUBMITTED").length, history: goals.map((goal) => ({ weekStart: goal.weekStart, target: goal.target, enabled: goal.enabled })) } : { enabled: false, history: goals.map((goal) => ({ weekStart: goal.weekStart, target: goal.target, enabled: goal.enabled })) },
      waitingForReview: pendingSubmissions.length,
      waitingForReviewDays: pendingActivityDays.length,
      pendingActivityDays,
    };
  });

  app.get("/api/profile/customize", async (request, reply) => {
    const context = await requireAuth(request, reply);
    if (!context) return;
    const [catalog, unlocks, appearance, prefs, membership] = await Promise.all([
      prisma.cosmeticItem.findMany({ orderBy: [{ unlockLevel: "asc" }, { type: "asc" }, { displayName: "asc" }] }),
      prisma.cosmeticUnlock.findMany({ where: { userId: context.user.id }, select: { cosmeticId: true } }),
      prisma.profileAppearance.findUnique({ where: { userId: context.user.id } }),
      prisma.userPreferences.findUnique({ where: { userId: context.user.id } }),
      context.membership ? prisma.membership.findUnique({ where: { id: context.membership.id }, select: { totalExp: true } }) : null,
    ]);
    const openIds = new Set(unlocks.map((unlock) => unlock.cosmeticId));
    const selected = appearance ?? { background: "pearl", emoji: "emoji-none", frame: "frame-none", title: "title-none", pattern: "pattern-none" };
    return {
      items: catalog.map((item) => ({ ...item, opened: openIds.has(item.id), selected: selected[{ PROFILE_BACKGROUND: "background", NICK_EMOJI: "emoji", AVATAR_FRAME: "frame", PROFILE_TITLE: "title", PROFILE_PATTERN: "pattern" }[item.type] as keyof typeof selected] === item.slug })),
      appearance: appearanceDto(selected),
      preferences: prefs,
      level: levelForExp(membership?.totalExp ?? 0),
      totalExp: membership?.totalExp ?? 0,
      unlocks: openIds.size,
    };
  });

  app.put("/api/profile/appearance", async (request, reply) => {
    const context = await requireAuth(request, reply);
    if (!context) return;
    const parsed = appearanceSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Выбор оформления заполнен неверно" });
    const appearance = parsed.data;
    const slugs = Object.values(appearance);
    const items = await prisma.cosmeticItem.findMany({ where: { slug: { in: slugs } } });
    const bySlug = new Map(items.map((item) => [item.slug, item]));
    const typeFor: Record<keyof typeof appearance, string> = { background: "PROFILE_BACKGROUND", emoji: "NICK_EMOJI", frame: "AVATAR_FRAME", title: "PROFILE_TITLE", pattern: "PROFILE_PATTERN" };
    for (const key of Object.keys(appearance) as Array<keyof typeof appearance>) {
      const item = bySlug.get(appearance[key]);
      if (!item || item.type !== typeFor[key]) return reply.code(400).send({ error: `Элемент «${appearance[key]}» не относится к категории «${key}»` });
      const currentLevel = levelForExp(context.membership?.totalExp ?? 0);
      if (item.unlockLevel > currentLevel) return reply.code(403).send({ error: `Элемент «${item.displayName}» откроется с уровня ${item.unlockLevel}` });
    }
    const allowed = await prisma.cosmeticUnlock.findMany({ where: { userId: context.user.id, cosmeticId: { in: items.map((item) => item.id) } }, select: { cosmeticId: true } });
    if (allowed.length !== items.length) return reply.code(403).send({ error: "В наборе есть оформление, которое ещё не открыто" });
    const saved = await prisma.profileAppearance.upsert({ where: { userId: context.user.id }, create: { userId: context.user.id, ...appearance }, update: appearance });
    return { ok: true, appearance: appearanceDto(saved) };
  });

  app.post("/api/profile/appearance/reset", async (request, reply) => {
    const context = await requireAuth(request, reply);
    if (!context) return;
    const baseline = { background: "pearl", emoji: "emoji-none", frame: "frame-none", title: "title-none", pattern: "pattern-none" };
    const saved = await prisma.profileAppearance.upsert({ where: { userId: context.user.id }, create: { userId: context.user.id, ...baseline }, update: baseline });
    return { ok: true, appearance: appearanceDto(saved) };
  });

  app.put("/api/profile/preferences", async (request, reply) => {
    const context = await requireAuth(request, reply);
    if (!context) return;
    const parsed = preferencesSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Проверьте значения настроек" });
    const preferences = await prisma.userPreferences.upsert({ where: { userId: context.user.id }, create: { userId: context.user.id, maxNotificationsEnabled: true, ...parsed.data }, update: parsed.data });
    return { ok: true, preferences };
  });

  app.put("/api/profile/pinned-achievements", async (request, reply) => {
    const context = await requireAuth(request, reply);
    if (!context) return;
    if (!context.membership) return reply.code(403).send({ error: "Сначала присоединитесь к школе" });
    const parsed = z.object({ achievementIds: z.array(z.string()).max(3) }).safeParse(request.body);
    if (!parsed.success || new Set(parsed.data.achievementIds).size !== parsed.data.achievementIds.length) return reply.code(400).send({ error: "Можно закрепить до трёх разных значков" });
    const owned = await prisma.achievement.findMany({ where: { id: { in: parsed.data.achievementIds }, membershipId: context.membership.id }, select: { id: true } });
    if (owned.length !== parsed.data.achievementIds.length) return reply.code(403).send({ error: "Можно закреплять только свои полученные достижения" });
    const saved = await prisma.$transaction(async (tx) => {
      await tx.pinnedAchievement.deleteMany({ where: { userId: context.user.id } });
      if (parsed.data.achievementIds.length) await tx.pinnedAchievement.createMany({ data: parsed.data.achievementIds.map((achievementId, position) => ({ userId: context.user.id, achievementId, position })) });
      return tx.pinnedAchievement.findMany({ where: { userId: context.user.id }, include: { achievement: true }, orderBy: { position: "asc" } });
    });
    return saved.map((pin) => ({ id: pin.achievement.id, name: pin.achievement.name, position: pin.position }));
  });

  app.put("/api/profile/weekly-goal", async (request, reply) => {
    const context = await requireAuth(request, reply);
    if (!context) return;
    if (!context.membership || context.membership.role !== "STUDENT") return reply.code(403).send({ error: "Личная цель доступна ученику с подтверждённой школьной принадлежностью" });
    const parsed = z.object({ target: z.number().int().min(1).max(5).nullable() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Цель должна быть от 1 до 5 работ или выключена" });
    const school = await prisma.school.findUniqueOrThrow({ where: { id: context.membership.schoolId } });
    const weekStart = mondayOfWeek(new Date(), school.timezone);
    const goal = await prisma.weeklyGoal.upsert({
      where: { membershipId_weekStart: { membershipId: context.membership.id, weekStart } },
      create: { membershipId: context.membership.id, weekStart, target: parsed.data.target ?? 1, enabled: parsed.data.target !== null },
      update: { target: parsed.data.target ?? 1, enabled: parsed.data.target !== null },
    });
    return { ok: true, goal };
  });
}
