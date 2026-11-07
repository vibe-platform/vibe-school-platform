import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Membership } from "@prisma/client";
import { prisma } from "../apps/api/src/db.js";
import { grantReward } from "../apps/api/src/rewards.js";

type Fixture = { membership: Membership; userId: string };
const userIds: string[] = [];
const assignmentIds: string[] = [];
let schoolId = "";
let classId = "";
let teacherId = "";

beforeAll(async () => {
  const teacher = await prisma.user.findUniqueOrThrow({ where: { testProfileKey: "user-2" }, include: { memberships: { where: { active: true, approved: true }, take: 1 } } });
  teacherId = teacher.id;
  schoolId = teacher.memberships[0]!.schoolId;
  classId = teacher.memberships[0]!.classId!;
});

afterAll(async () => {
  if (assignmentIds.length) await prisma.assignment.deleteMany({ where: { id: { in: assignmentIds } } });
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

async function createStudent(label: string): Promise<Fixture> {
  const user = await prisma.user.create({
    data: { firstName: `QA ${label}`, lastName: "Reward", memberships: { create: { schoolId, classId, role: "STUDENT", active: true, approved: true } } },
    include: { memberships: true },
  });
  userIds.push(user.id);
  return { membership: user.memberships[0]!, userId: user.id };
}

async function createSubmission(membershipId: string, grade: number, dayKey: string, index: number, status: "COMPLETED" | "SUBMITTED" = "COMPLETED") {
  const assignment = await prisma.assignment.create({
    data: {
      schoolId, teacherId, title: `QA reward ${index} ${dayKey}`, subject: "QA", category: "Учёба", description: "Isolated reward policy fixture", published: true,
      questions: { create: { prompt: "Fixture answer", type: "SHORT_TEXT", points: 100, acceptedJson: JSON.stringify(["done"]) } },
      targets: { create: { classId, recipients: { connect: { id: membershipId } } } },
    },
    include: { questions: true },
  });
  assignmentIds.push(assignment.id);
  const submittedAt = new Date(`${dayKey}T12:00:00+03:00`);
  const submission = await prisma.submission.create({
    data: {
      assignmentId: assignment.id, membershipId, attempt: 1, status, startedAt: submittedAt, submittedAt,
      checkedAt: status === "COMPLETED" ? new Date("2026-06-01T12:00:00+03:00") : null,
      grade: status === "COMPLETED" ? grade : null, earnedPoints: status === "COMPLETED" ? grade * 20 : null,
      maxPoints: status === "COMPLETED" ? 100 : null,
      answers: { create: { questionId: assignment.questions[0]!.id, textValue: "done", earnedPoints: status === "COMPLETED" ? grade * 20 : null } },
    },
  });
  return submission;
}

async function award(submissionId: string) {
  return prisma.$transaction((tx) => grantReward(tx, submissionId));
}

async function creditedTotal(membershipId: string, referenceIds?: string[]) {
  const entries = await prisma.ledgerEntry.findMany({ where: { membershipId, kind: { in: ["TASK_REWARD", "STREAK_ADJUSTMENT"] }, ...(referenceIds ? { referenceId: { in: referenceIds } } : {}) } });
  return { amount: entries.reduce((sum, entry) => sum + entry.amount, 0), exp: entries.reduce((sum, entry) => sum + entry.expAmount, 0), entries };
}

describe("grade-based rewards and historical streak reconciliation", () => {
  it("credits 13 consecutive high and low grade awards to 165/86 Einsteins and exactly 13 EXP each", async () => {
    const high = await createStudent("High13");
    const low = await createStudent("Low13");
    for (let day = 1; day <= 13; day += 1) {
      const date = `2026-01-${String(day).padStart(2, "0")}`;
      const highSubmission = await createSubmission(high.membership.id, 5, date, day);
      const lowSubmission = await createSubmission(low.membership.id, 3, date, day + 20);
      await award(highSubmission.id);
      await award(lowSubmission.id);
    }
    const highTotal = await creditedTotal(high.membership.id);
    const lowTotal = await creditedTotal(low.membership.id);
    expect(highTotal).toMatchObject({ amount: 165, exp: 13 });
    expect(lowTotal).toMatchObject({ amount: 86, exp: 13 });
    const lastHigh = highTotal.entries.find((entry) => entry.rewardDayKey === "2026-01-13");
    const lastLow = lowTotal.entries.find((entry) => entry.rewardDayKey === "2026-01-13");
    expect(lastHigh).toMatchObject({ amount: 15, rewardMultiplierTenths: 15, rewardTargetAmount: 15, rewardGradeSnapshot: 5, rewardPolicyVersion: "GRADE_STREAK_V2" });
    expect(lastLow).toMatchObject({ amount: 8, rewardMultiplierTenths: 15, rewardTargetAmount: 8, rewardGradeSnapshot: 3, rewardPolicyVersion: "GRADE_STREAK_V2" });
  });

  it("uses submission dates for late reviews, tops up only the missing Einstein, and refuses duplicate or pending awards", async () => {
    const { membership } = await createStudent("LateReviews");
    const days = [
      await createSubmission(membership.id, 5, "2026-03-01", 51),
      await createSubmission(membership.id, 3, "2026-03-02", 52),
      await createSubmission(membership.id, 4, "2026-03-03", 53),
    ];
    const awardAtReview = [];
    for (const index of [2, 0, 1]) awardAtReview.push(await award(days[index]!.id));
    expect(awardAtReview.map((item) => item?.einsteins)).toEqual([10, 10, 5]);
    const references = days.map((submission) => submission.id);
    const total = await creditedTotal(membership.id, references);
    expect(total).toMatchObject({ amount: 26, exp: 3 });
    const lateAdjustment = total.entries.find((entry) => entry.kind === "STREAK_ADJUSTMENT");
    expect(lateAdjustment).toMatchObject({ amount: 1, expAmount: 0, rewardDayKey: "2026-03-03", rewardMultiplierTenths: 11, rewardTargetAmount: 11 });
    expect(await prisma.activityDay.count({ where: { membershipId: membership.id } })).toBe(3);

    const beforeDuplicate = total.entries.length;
    expect(await award(days[2]!.id)).toBeNull();
    expect((await creditedTotal(membership.id, references)).entries).toHaveLength(beforeDuplicate);

    const pending = await createSubmission(membership.id, 0, "2026-03-04", 54, "SUBMITTED");
    expect(await award(pending.id)).toBeNull();
    expect(await prisma.activityDay.count({ where: { membershipId: membership.id } })).toBe(3);
    expect(await prisma.membership.findUniqueOrThrow({ where: { id: membership.id }, select: { balance: true, totalExp: true } })).toMatchObject({ balance: 26, totalExp: 3 });
  });
});
