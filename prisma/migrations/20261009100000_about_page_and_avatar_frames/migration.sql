INSERT OR IGNORE INTO "CosmeticItem" ("id", "slug", "type", "unlockLevel", "displayName", "assetKey", "value", "groupKey")
VALUES
  ('cosmetic_frame_lavender_glow_v1', 'frame-lavender-glow', 'AVATAR_FRAME', 6, 'Лавандовое сияние', 'frame-lavender-glow', 'lavender-glow', NULL),
  ('cosmetic_frame_mint-glass_v1', 'frame-mint-glass', 'AVATAR_FRAME', 6, 'Мятное стекло', 'frame-mint-glass', 'mint-glass', NULL);

INSERT OR IGNORE INTO "CosmeticUnlock" ("id", "userId", "cosmeticId", "source", "sourceRef", "unlockedAt")
SELECT lower(hex(randomblob(16))), membership."userId", cosmetic."id", 'MIGRATION', NULL, CURRENT_TIMESTAMP
FROM "Membership" AS membership
CROSS JOIN "CosmeticItem" AS cosmetic
WHERE membership."totalExp" >= 35
  AND cosmetic."slug" IN ('frame-lavender-glow', 'frame-mint-glass');

CREATE TABLE "AboutPage" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'main',
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "updatedAt" DATETIME NOT NULL,
  "updatedById" TEXT,
  CONSTRAINT "AboutPage_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "AboutImage" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "pageId" TEXT NOT NULL,
  "uploaderId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AboutImage_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "AboutPage" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AboutImage_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "AboutTeamMember" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "pageId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "imageAttachmentId" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isVisible" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "AboutTeamMember_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "AboutPage" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AboutTeamMember_imageAttachmentId_fkey" FOREIGN KEY ("imageAttachmentId") REFERENCES "AboutImage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "AboutSection" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "pageId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "imageAttachmentId" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isVisible" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "AboutSection_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "AboutPage" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AboutSection_imageAttachmentId_fkey" FOREIGN KEY ("imageAttachmentId") REFERENCES "AboutImage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AboutImage_fileName_key" ON "AboutImage"("fileName");
CREATE INDEX "AboutImage_pageId_createdAt_idx" ON "AboutImage"("pageId", "createdAt");
CREATE INDEX "AboutImage_uploaderId_idx" ON "AboutImage"("uploaderId");
CREATE INDEX "AboutTeamMember_pageId_isVisible_sortOrder_idx" ON "AboutTeamMember"("pageId", "isVisible", "sortOrder");
CREATE INDEX "AboutSection_pageId_isVisible_sortOrder_idx" ON "AboutSection"("pageId", "isVisible", "sortOrder");

INSERT INTO "AboutPage" ("id", "title", "description", "updatedAt", "updatedById")
VALUES ('main', 'О Вайбе', 'Вайб помогает сделать школьную жизнь интереснее и доброжелательнее. Здесь важны усилия, любознательность и поддержка: каждый может пробовать новое, видеть свой личный прогресс и получать признание за вклад.', CURRENT_TIMESTAMP, NULL);
