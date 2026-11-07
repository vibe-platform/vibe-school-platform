ALTER TABLE "User" ADD COLUMN "testProfileKey" TEXT;
CREATE UNIQUE INDEX "User_testProfileKey_key" ON "User"("testProfileKey");

ALTER TABLE "Session" ADD COLUMN "authSource" TEXT NOT NULL DEFAULT 'MAX';

ALTER TABLE "LedgerEntry" ADD COLUMN "rewardScopeKey" TEXT;
CREATE UNIQUE INDEX "LedgerEntry_rewardScopeKey_key" ON "LedgerEntry"("rewardScopeKey");

ALTER TABLE "Upload" ADD COLUMN "assignmentId" TEXT REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Upload_assignmentId_idx" ON "Upload"("assignmentId");
