import { PrismaClient } from "@prisma/client";
import { writeFile, access } from "node:fs/promises";
const db = new PrismaClient();
try {
  if (process.argv[2] === "setup") {
    const owner = await db.user.findUniqueOrThrow({ where: { testProfileKey: "user-4" } });
    await db.aboutImage.upsert({ where: { id: "cmw6hhbbn00h69zr9ce8abav8" }, create: { id: "cmw6hhbbn00h69zr9ce8abav8", pageId: "main", uploaderId: owner.id, fileName: "239386ff749dee45a935b7f9b7537d0944a3e8eb83ef8de59ae3aafdc73c2dcf.jpg", mimeType: "image/jpeg" }, update: {} });
    await db.aboutTeamMember.update({ where: { id: "cmw6hllgq00hi9zr988hykjw6" }, data: { imageAttachmentId: "cmw6hhbbn00h69zr9ce8abav8" } });
    await writeFile("/app/data/uploads/239386ff749dee45a935b7f9b7537d0944a3e8eb83ef8de59ae3aafdc73c2dcf.jpg", "test old file");
  } else {
    const row = await db.aboutTeamMember.findUniqueOrThrow({ where: { id: "cmw6hllgq00hi9zr988hykjw6" } });
    if (row.imageAttachmentId !== "cmw6r183t00ld9zr9i5yks9ql") throw new Error("Photo was not updated");
    if (await db.aboutImage.findUnique({ where: { id: "cmw6hhbbn00h69zr9ce8abav8" } })) throw new Error("Old image row remains");
    if (await access("/app/data/uploads/239386ff749dee45a935b7f9b7537d0944a3e8eb83ef8de59ae3aafdc73c2dcf.jpg").then(() => true, () => false)) throw new Error("Old image file remains");
    console.log("Photo update and removal verified");
  }
} finally { await db.$disconnect(); }
