                 
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ProfileAppearance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "background" TEXT NOT NULL DEFAULT 'pearl',
    "emoji" TEXT NOT NULL DEFAULT 'emoji-none',
    "frame" TEXT NOT NULL DEFAULT 'frame-none',
    "title" TEXT NOT NULL DEFAULT 'title-none',
    "pattern" TEXT NOT NULL DEFAULT 'pattern-none',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProfileAppearance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ProfileAppearance" ("background", "emoji", "frame", "id", "pattern", "title", "updatedAt", "userId") SELECT "background", "emoji", "frame", "id", "pattern", "title", "updatedAt", "userId" FROM "ProfileAppearance";
DROP TABLE "ProfileAppearance";
ALTER TABLE "new_ProfileAppearance" RENAME TO "ProfileAppearance";
UPDATE "ProfileAppearance" SET "emoji" = 'emoji-none' WHERE "emoji" = 'none';
UPDATE "ProfileAppearance" SET "frame" = 'frame-none' WHERE "frame" = 'none';
UPDATE "ProfileAppearance" SET "title" = 'title-none' WHERE "title" = 'none';
UPDATE "ProfileAppearance" SET "pattern" = 'pattern-none' WHERE "pattern" = 'none';
CREATE UNIQUE INDEX "ProfileAppearance_userId_key" ON "ProfileAppearance"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
