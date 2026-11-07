import { PrismaClient } from "@prisma/client";
import { unlink } from "node:fs/promises";
const db = new PrismaClient();
try {
  const member = await db.aboutTeamMember.findUnique({ where: { id: "cmw6hllgq00hi9zr988hykjw6" } });
  if (member?.imageAttachmentId === "cmw6hhbbn00h69zr9ce8abav8") {
    const owner = await db.user.findUniqueOrThrow({ where: { testProfileKey: "user-4" } });
    await db.aboutImage.upsert({
      where: { id: "cmw6r183t00ld9zr9i5yks9ql" },
      create: { id: "cmw6r183t00ld9zr9i5yks9ql", pageId: "main", uploaderId: owner.id, fileName: "f1ff6abc9905a49e58caa870bf828ea102548602938466b9ddb4a2565c98c618.jpg", mimeType: "image/jpeg" },
      update: {},
    });
    await db.aboutTeamMember.updateMany({ where: { id: "cmw6hllgq00hi9zr988hykjw6", imageAttachmentId: "cmw6hhbbn00h69zr9ce8abav8" }, data: { imageAttachmentId: "cmw6r183t00ld9zr9i5yks9ql" } });
    const stillUsed = await db.aboutImage.findFirst({ where: { id: "cmw6hhbbn00h69zr9ce8abav8", OR: [{ teamMembers: { some: {} } }, { sections: { some: {} } }, { cooperationMedia: { isNot: null } }] } });
    if (!stillUsed) {
      await db.aboutImage.deleteMany({ where: { id: "cmw6hhbbn00h69zr9ce8abav8" } });
      const otherReferences = await Promise.all([
        db.aboutImage.count({ where: { fileName: "239386ff749dee45a935b7f9b7537d0944a3e8eb83ef8de59ae3aafdc73c2dcf.jpg" } }),
        db.productImage.count({ where: { fileName: "239386ff749dee45a935b7f9b7537d0944a3e8eb83ef8de59ae3aafdc73c2dcf.jpg" } }),
        db.projectDocument.count({ where: { fileName: "239386ff749dee45a935b7f9b7537d0944a3e8eb83ef8de59ae3aafdc73c2dcf.jpg" } }),
        db.upload.count({ where: { fileName: "239386ff749dee45a935b7f9b7537d0944a3e8eb83ef8de59ae3aafdc73c2dcf.jpg" } }),
      ]);
      if (otherReferences.every((count) => count === 0)) await unlink("/app/data/uploads/239386ff749dee45a935b7f9b7537d0944a3e8eb83ef8de59ae3aafdc73c2dcf.jpg").catch((error) => { if (error.code !== "ENOENT") throw error; });
    }
  }
} finally { await db.$disconnect(); }
