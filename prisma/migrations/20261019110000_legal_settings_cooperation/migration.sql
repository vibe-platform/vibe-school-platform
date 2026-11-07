CREATE TABLE "LegalSettings" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'main',
  "organizationFullName" TEXT,
  "organizationShortName" TEXT,
  "legalAddress" TEXT,
  "location" TEXT,
  "inn" TEXT,
  "ogrn" TEXT,
  "generalEmail" TEXT,
  "privacyEmail" TEXT,
  "domain" TEXT,
  "hostingProvider" TEXT,
  "serverLocationConfirmed" BOOLEAN NOT NULL DEFAULT false,
  "roskomnadzorNotificationStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "operatorDetailsConfirmed" BOOLEAN NOT NULL DEFAULT false,
  "childDataLegalReviewComplete" BOOLEAN NOT NULL DEFAULT false,
  "privacyVersion" TEXT,
  "termsVersion" TEXT,
  "updatedAt" DATETIME NOT NULL,
  "updatedById" TEXT,
  CONSTRAINT "LegalSettings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "CooperationPartner" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "category" TEXT,
  "city" TEXT,
  "shortDescription" TEXT NOT NULL,
  "mapUrl" TEXT,
  "isPublished" BOOLEAN NOT NULL DEFAULT false,
  "isSynthetic" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "archivedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "updatedById" TEXT,
  CONSTRAINT "CooperationPartner_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "CooperationMedia" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "partnerId" TEXT NOT NULL,
  "imageAttachmentId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "caption" TEXT NOT NULL DEFAULT '',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CooperationMedia_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "CooperationPartner" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CooperationMedia_imageAttachmentId_fkey" FOREIGN KEY ("imageAttachmentId") REFERENCES "AboutImage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CooperationMedia_imageAttachmentId_key" ON "CooperationMedia"("imageAttachmentId");
CREATE INDEX "CooperationPartner_isSynthetic_archivedAt_isPublished_sortOrder_idx" ON "CooperationPartner"("isSynthetic", "archivedAt", "isPublished", "sortOrder");
CREATE INDEX "CooperationMedia_partnerId_type_sortOrder_idx" ON "CooperationMedia"("partnerId", "type", "sortOrder");
