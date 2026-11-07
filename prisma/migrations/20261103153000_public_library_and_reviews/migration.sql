CREATE TABLE "ProjectDocument" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "category" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isSynthetic" BOOLEAN NOT NULL DEFAULT false,
  "fileName" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "publishedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "ProjectDocument_fileName_key" ON "ProjectDocument"("fileName");
CREATE INDEX "ProjectDocument_isSynthetic_status_category_sortOrder_publishedAt_idx"
ON "ProjectDocument"("isSynthetic", "status", "category", "sortOrder", "publishedAt");

CREATE TABLE "PublicReview" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "authorId" TEXT NOT NULL,
  "rating" INTEGER NOT NULL,
  "body" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "isSynthetic" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "moderatedAt" DATETIME,
  CONSTRAINT "PublicReview_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "PublicReview_isSynthetic_status_createdAt_idx" ON "PublicReview"("isSynthetic", "status", "createdAt");
CREATE INDEX "PublicReview_authorId_isSynthetic_createdAt_idx" ON "PublicReview"("authorId", "isSynthetic", "createdAt");
