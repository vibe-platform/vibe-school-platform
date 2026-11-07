import type { Prisma, PrismaClient } from "@prisma/client";
import { rewardForBaseAndStreak, rewardForGradeAndStreak, rewardPolicyVersion, gradeFromPercent, levelForExp } from "@vibe/shared";
import { localDateKey, streakAt } from "./dates.js";

type Tx = Prisma.TransactionClient;
export async function grantUnlocks(tx: Tx, userId: string, totalExp: number, source: string, sourceRef?: string) {
  const level = levelForExp(totalExp);
  const eligible = await tx.cosmeticItem.findMany({ where: { unlockLevel: { lte: level } }, select: { id: true } });
  if (eligible.length) {
    const existing = await tx.cosmeticUnlock.findMany({ where: { userId, cosmeticId: { in: eligible.map((item) => item.id) } }, select: { cosmeticId: true } });
    const existingIds = new Set(existing.map((row) => row.cosmeticId));
    const missing = eligible.filter((item) => !existingIds.has(item.id));
    if (!missing.length) return;
    await tx.cosmeticUnlock.createMany({
      data: missing.map((item) => ({ userId, cosmeticId: item.id, source, sourceRef })),
    });
  }
}

const formatTenths = (value: number) => `${Math.floor(value / 10)}${value % 10 ? `,${value % 10}` : ""}`;

export type RewardAward = {
  grade: number;
  baseReward: number;
  multiplierTenths: number;
  einsteins: number;
  exp: 1;
  note: string;
};

export async function grantReward(tx: Tx, submissionId: string): Promise<RewardAward | null> {
  const submission = await tx.submission.findUnique({
    where: { id: submissionId },
    include: { membership: { include: { school: true, user: true } }, assignment: { include: { questions: true } } },
  });
  if (!submission || submission.rewardGranted || submission.status !== "COMPLETED" || !submission.checkedAt || !submission.submittedAt || !submission.membership.active) return null;
  if (submission.membership.role !== "STUDENT") return null;
  const calculation = rewardForGradeAndStreak(submission.grade, 1);
  if (!calculation) return null;
  const rewardScopeKey = `task:${submission.membershipId}:${submission.assignmentId}`;
  const priorTaskReward = await tx.ledgerEntry.findUnique({ where: { rewardScopeKey }, select: { id: true } });
  const priorSubmissionIds = await tx.submission.findMany({ where: { assignmentId: submission.assignmentId, membershipId: submission.membershipId, id: { not: submissionId } }, select: { id: true } });
  const priorLegacyReward = priorSubmissionIds.length ? await tx.ledgerEntry.findFirst({ where: { membershipId: submission.membershipId, kind: "TASK_REWARD", referenceId: { in: priorSubmissionIds.map((row) => row.id) } }, select: { id: true } }) : null;
  if (priorTaskReward || priorLegacyReward) {
    await tx.submission.update({ where: { id: submissionId }, data: { rewardGranted: true } });
    return null;
  }
  const answers = await tx.answer.findMany({ where: { submissionId }, include: { question: true, uploads: true } });
  const nonEmpty = answers.some((answer) => answer.textValue.trim().length > 0 || answer.uploads.length > 0);
  if (!nonEmpty) return null;
  const claimed = await tx.submission.updateMany({ where: { id: submissionId, rewardGranted: false, status: "COMPLETED", grade: submission.grade }, data: { rewardGranted: true } });
  if (claimed.count !== 1) return null;
  const dayKey = localDateKey(submission.submittedAt, submission.membership.school.timezone);
  await tx.activityDay.upsert({ where: { membershipId_dayKey: { membershipId: submission.membershipId, dayKey } }, create: { membershipId: submission.membershipId, dayKey }, update: {} });
  const activity = await tx.activityDay.findMany({ where: { membershipId: submission.membershipId }, select: { dayKey: true } });
  const activeDays = new Set(activity.map((day) => day.dayKey));
  const streak = streakAt(dayKey, activeDays);
  const reward = rewardForGradeAndStreak(submission.grade, streak);
  if (!reward) return null;
  const math = `${reward.baseReward} × ${formatTenths(reward.multiplierTenths)} = ${formatTenths(reward.baseReward * reward.multiplierTenths)} → ${reward.einsteins}`;
  const note = `Оценка ${reward.grade}: ${math} Эйнштейнов; +1 EXP`;
  const updated = await tx.membership.update({ where: { id: submission.membershipId }, data: { totalExp: { increment: 1 }, balance: { increment: reward.einsteins } } });
  await tx.ledgerEntry.create({
    data: {
      membershipId: updated.id, kind: "TASK_REWARD", amount: reward.einsteins, expAmount: 1,
      balanceAfter: updated.balance, totalExpAfter: updated.totalExp, referenceId: submissionId,
      idempotencyKey: `task:${submissionId}`, rewardScopeKey, note,
      rewardPolicyVersion, rewardGradeSnapshot: reward.grade, rewardBaseAmount: reward.baseReward,
      rewardDayKey: dayKey, rewardMultiplierTenths: reward.multiplierTenths, rewardTargetAmount: reward.einsteins,
    },
  });
  await grantUnlocks(tx, submission.membership.userId, updated.totalExp, "CONFIRMED_EXP", submissionId);
  await awardAchievements(tx, updated.id, submissionId);
  await reconcileStreakRewards(tx, updated.id);
  return { grade: reward.grade, baseReward: reward.baseReward, multiplierTenths: reward.multiplierTenths, einsteins: reward.einsteins, exp: 1, note };
}

async function reconcileStreakRewards(tx: Tx, membershipId: string) {
  const initialAwards = await tx.ledgerEntry.findMany({
    where: { membershipId, kind: "TASK_REWARD", rewardPolicyVersion, referenceId: { not: null }, rewardBaseAmount: { in: [5, 10] }, rewardDayKey: { not: null } },
    orderBy: { createdAt: "asc" },
  });
  const days = await tx.activityDay.findMany({ where: { membershipId }, select: { dayKey: true } });
  const activeDays = new Set(days.map((day) => day.dayKey));
  for (const award of initialAwards) {
    if (!award.referenceId || !award.rewardDayKey || !award.rewardBaseAmount) continue;
    const calculation = rewardForBaseAndStreak(award.rewardBaseAmount, streakAt(award.rewardDayKey, activeDays));
    const target = calculation.einsteins;
    const entries = await tx.ledgerEntry.findMany({ where: { membershipId, referenceId: award.referenceId, kind: { in: ["TASK_REWARD", "STREAK_ADJUSTMENT"] } }, select: { amount: true } });
    const paid = entries.reduce((sum, entry) => sum + entry.amount, 0);
    const delta = Math.max(0, target - paid);
    if (delta > 0) {
      const updated = await tx.membership.update({ where: { id: membershipId }, data: { balance: { increment: delta } } });
      const note = `Позднее подтверждение серии: оценка ${award.rewardGradeSnapshot}; ${award.rewardBaseAmount} × ${formatTenths(calculation.multiplierTenths)} → ${target}; доплата +${delta} Эйнштейнов`;
      await tx.ledgerEntry.create({ data: {
        membershipId, kind: "STREAK_ADJUSTMENT", amount: delta, expAmount: 0,
        balanceAfter: updated.balance, totalExpAfter: updated.totalExp, referenceId: award.referenceId,
        idempotencyKey: `streak:${award.referenceId}:v2:target:${target}`, note,
        rewardPolicyVersion, rewardGradeSnapshot: award.rewardGradeSnapshot, rewardBaseAmount: award.rewardBaseAmount,
        rewardDayKey: award.rewardDayKey, rewardMultiplierTenths: calculation.multiplierTenths, rewardTargetAmount: target,
      } });
    }
  }
}

async function awardAchievements(tx: Tx, membershipId: string, submissionId: string) {
  const count = await tx.submission.count({ where: { membershipId, rewardGranted: true } });
  const current = await tx.submission.findUnique({ where: { id: submissionId }, include: { assignment: true } });
  const facts = [
    ...(count >= 1 ? [{ slug: "first-task", name: "Первая работа" }] : []),
    ...(count >= 5 ? [{ slug: "five-tasks", name: "Пять завершённых работ" }] : []),
    ...(current?.assignment.category === "Творчество" ? [{ slug: "creative-task", name: "Творческий подход" }] : []),
    ...(current?.assignment.category === "Волонтёрство" ? [{ slug: "volunteer-task", name: "Доброе дело" }] : []),
  ];
  for (const achievement of facts) {
    await tx.achievement.upsert({ where: { membershipId_slug: { membershipId, slug: achievement.slug } }, create: { membershipId, ...achievement, evidenceRef: submissionId }, update: {} });
  }
  const activeDays = await tx.activityDay.findMany({ where: { membershipId }, select: { dayKey: true } });
  const daySet = new Set(activeDays.map((day) => day.dayKey));
  if ([...daySet].some((day) => streakAt(day, daySet) >= 3)) {
    await tx.achievement.upsert({ where: { membershipId_slug: { membershipId, slug: "three-day-streak" } }, create: { membershipId, slug: "three-day-streak", name: "Три дня в ритме", evidenceRef: [...daySet].sort()[0] ?? submissionId }, update: {} });
  }
}

export async function finalizeGrade(client: PrismaClient | Tx, submissionId: string, earnedPoints: number, maxPoints: number) {
  const grade = gradeFromPercent(maxPoints > 0 ? earnedPoints / maxPoints * 100 : 0);
  await client.submission.update({ where: { id: submissionId }, data: { earnedPoints, maxPoints, grade, status: "COMPLETED", checkedAt: new Date() } });
  return grade;
}

export async function systemBackfillUnlocks(client: PrismaClient) {
  const users = await client.user.findMany({ include: { memberships: { where: { active: true, role: "STUDENT" } } } });
  await client.$transaction(async (tx) => {
    for (const user of users) {
      await grantUnlocks(tx, user.id, Math.max(0, ...user.memberships.map((membership) => membership.totalExp)), "MIGRATION_BACKFILL");
    }
  });
}
