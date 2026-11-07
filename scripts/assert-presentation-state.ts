import { PrismaClient } from "@prisma/client";
import { levelForExp } from "@vibe/shared";
import { cosmetics } from "../prisma/cosmetics.js";

const prisma = new PrismaClient();

try {
  const profiles = await prisma.user.findMany({
    where: { testProfileKey: { in: ["user-1", "user-2", "user-3", "user-4"] } },
    include: { memberships: { where: { active: true, approved: true }, include: { school: true, schoolClass: true } }, _count: { select: { memberships: true } }, cosmeticUnlocks: { include: { cosmetic: true } } },
    orderBy: { testProfileKey: "asc" },
  });
  if (profiles.length !== 4) throw new Error(`Expected 4 canonical profiles, got ${profiles.length}`);
  if (await prisma.cosmeticItem.count() !== cosmetics.length) throw new Error(`Expected ${cosmetics.length} catalog items across levels 1–10`);
  const demoAssignments = await prisma.assignment.findMany({ where: { seedKey: { in: ["presentation-quick-space", "presentation-photo-observation"] } }, select: { seedKey: true, published: true, archived: true, dueAt: true, targets: { select: { classId: true } } } });
  if (demoAssignments.length !== 2 || demoAssignments.some((item) => !item.published || item.archived || !item.dueAt || item.dueAt <= new Date() || item.targets.length !== 1)) throw new Error("Presentation tasks are missing, expired, unpublished, or no longer assigned to 7A");
  const presentationProducts = await prisma.product.count({ where: { slug: { in: ["presentation-sticker", "presentation-reading-bookmark", "presentation-school-choice", "presentation-school-book"] }, active: true, isSynthetic: true } });
  if (presentationProducts !== 4) throw new Error(`Expected four active products for market category checks, got ${presentationProducts}`);
  const expectedRoles = ["STUDENT", "TEACHER", "SCHOOL_ADMIN"];
  for (const [index, profile] of profiles.slice(0, 3).entries()) {
    const membership = profile.memberships[0];
    if (profile.displayName !== `Пользователь ${index + 1}` || profile.firstName || profile.lastName) throw new Error(`Unexpected identity data for user-${index + 1}`);
    if (profile.memberships.length !== 1 || membership?.role !== expectedRoles[index] || membership.school.name !== "Школа Вайб № 21" || membership.schoolClass?.name !== "7A") throw new Error(`Unexpected role or presentation school for user-${index + 1}`);
    const expectedUnlocks = cosmetics.filter((item) => item.level <= levelForExp(membership.totalExp)).length;
    if (profile.cosmeticUnlocks.length !== expectedUnlocks) throw new Error(`user-${index + 1} should have ${expectedUnlocks} level-based unlocks; got ${profile.cosmeticUnlocks.length}`);
  }
  const administrator = profiles[2]!.memberships[0]!;
  if (administrator.isTeacher) throw new Error("The school-admin profile must not also hold TEACHER access");
  const teacher = profiles[1]!.memberships[0]!;
  if (!teacher.classId || !(await prisma.teacherClass.findFirst({ where: { teacherId: teacher.id, classId: teacher.classId, active: true } }))) throw new Error("The canonical teacher is not actively assigned to the canonical class");
  const owner = profiles[3]!;
  if (owner.displayName !== "Пользователь 4" || owner.firstName || owner.lastName || owner.platformRole !== "PROJECT_OWNER" || owner.maxUserId || owner.isBlocked || owner._count.memberships) throw new Error("The synthetic project owner must be a separate, unblocked global role without a school membership");
  const testSchool = await prisma.school.findUniqueOrThrow({ where: { id: profiles[0]!.memberships[0]!.schoolId } });
  const activePresentationSchools = await prisma.school.count({ where: { isSynthetic: true, archivedAt: null } });
  if (!testSchool.isSynthetic || testSchool.archivedAt || activePresentationSchools < 1) throw new Error("Canonical presentation school is unavailable or not isolated as synthetic");
  console.info(JSON.stringify({ profiles: profiles.length, roles: [...expectedRoles, "PROJECT_OWNER"], catalogItems: cosmetics.length, levels: 10, baselineUnlocks: profiles.slice(0, 3).map((profile) => profile.cosmeticUnlocks.length), ownerHasSchoolMembership: owner._count.memberships !== 0, activePresentationSchools, archivedPresentationSchools: await prisma.school.count({ where: { isSynthetic: true, archivedAt: { not: null } } }), currentPresentationTasks: demoAssignments.length, marketProducts: presentationProducts, school: testSchool.name, className: profiles[0]!.memberships[0]!.schoolClass?.name }, null, 2));
} finally {
  await prisma.$disconnect();
}
