CREATE TABLE "LegalAcceptance" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "documentType" TEXT NOT NULL,
  "documentVersion" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "consentStatus" TEXT NOT NULL,
  "acceptedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" DATETIME,
  CONSTRAINT "LegalAcceptance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "LegalAcceptance_userId_documentType_documentVersion_key"
ON "LegalAcceptance"("userId", "documentType", "documentVersion");

CREATE INDEX "LegalAcceptance_userId_documentType_acceptedAt_idx"
ON "LegalAcceptance"("userId", "documentType", "acceptedAt");
