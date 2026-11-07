import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const expected = ["user-1", "user-2", "user-3", "user-4"];

try {
  const users = await prisma.user.findMany({
    where: { testProfileKey: { in: expected } },
    include: { memberships: { where: { active: true, approved: true }, include: { school: { select: { name: true } }, schoolClass: { select: { name: true } } } }, _count: { select: { memberships: true } } },
    orderBy: { testProfileKey: "asc" },
  });
  if (users.length !== 4) throw new Error(`Expected exactly four canonical profiles, found ${users.length}`);
  const student = users.find((user) => user.testProfileKey === "user-1");
  const teacher = users.find((user) => user.testProfileKey === "user-2");
  const administrator = users.find((user) => user.testProfileKey === "user-3");
  const owner = users.find((user) => user.testProfileKey === "user-4");
  if (student?.displayName !== "Пользователь 1" || student.firstName || student.lastName) throw new Error("Student display name or identity fields were not preserved");
  if (teacher?.displayName !== "Пользователь 2" || teacher.firstName || teacher.lastName) throw new Error("Teacher display name or identity fields were not preserved");
  if (administrator?.displayName !== "Пользователь 3" || administrator.firstName || administrator.lastName) throw new Error("School-admin display name or identity fields were not preserved");
  if (owner?.displayName !== "Пользователь 4" || owner.firstName || owner.lastName || owner.platformRole !== "PROJECT_OWNER" || owner._count.memberships) throw new Error("Project owner must be a separate global role without school memberships");
  const studentMembership = student.memberships[0];
  const teacherMembership = teacher.memberships[0];
  const adminMembership = administrator.memberships[0];
  if (!studentMembership || studentMembership.role !== "STUDENT" || studentMembership.schoolClass?.name !== "7A") throw new Error("Student role/class was not preserved");
  if (!teacherMembership || teacherMembership.role !== "TEACHER" || teacherMembership.schoolClass?.name !== "7A") throw new Error("Teacher role/class was not preserved");
  if (!adminMembership || adminMembership.role !== "SCHOOL_ADMIN" || adminMembership.isTeacher || adminMembership.schoolClass?.name !== "7A") throw new Error("School-admin role was not preserved");
  if (studentMembership.balance !== 70 || studentMembership.totalExp !== 8) throw new Error("Idempotent seed reset the student balance/EXP earned during the browser scenarios");
  const schoolId = studentMembership.schoolId;
  if (users.filter((user) => user.testProfileKey !== "user-4").some((user) => user.memberships[0]?.schoolId !== schoolId || user.memberships[0]?.school.name !== "Школа Вайб № 21")) throw new Error("The three canonical school profiles are not in the same presentation school");
  if (await prisma.membership.count({ where: { schoolId, active: true, approved: true } }) !== 3) throw new Error("Presentation school has an unexpected active account count");
  if (await prisma.assignment.count({ where: { schoolId, published: true, archived: false } }) !== 12) throw new Error("The seed re-run did not preserve the two presentation tasks and ten browser-created assignments");
  if (await prisma.assignment.count({ where: { schoolId, seedKey: null, published: true, archived: false } }) !== 10) throw new Error("The browser did not create ten distinct published work records");
  if (await prisma.ledgerEntry.count({ where: { membershipId: studentMembership.id, rewardScopeKey: { not: null } } }) !== 8) throw new Error("The seed re-run did not preserve exactly eight one-time task rewards");
  const earnedEmoji = await prisma.cosmeticItem.findUniqueOrThrow({ where: { slug: "spark-1" } });
  const appearance = await prisma.profileAppearance.findUniqueOrThrow({ where: { userId: student.id } });
  if (appearance.emoji !== "spark-1" || !(await prisma.cosmeticUnlock.findUnique({ where: { userId_cosmeticId: { userId: student.id, cosmeticId: earnedEmoji.id } } }))) throw new Error("The seed re-run did not preserve earned and applied level-2 cosmetics");
  const fulfilledSchoolOrders = await prisma.order.count({ where: { membershipId: studentMembership.id, product: { scope: "SCHOOL" }, status: "FULFILLED" } });
  if (fulfilledSchoolOrders !== 1) throw new Error("The admin did not fulfill the one browser-created school-market order");
  console.info("Idempotent presentation seed preserved four canonical profiles (student/teacher/school-admin/project-owner), 2 seeded + 10 browser-created published assignments, student balance 70 after one school purchase, EXP 8, 8 scoped rewards, a fulfilled order, and earned appearance.");
} finally {
  await prisma.$disconnect();
}
