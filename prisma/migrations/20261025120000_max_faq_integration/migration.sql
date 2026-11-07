ALTER TABLE "User" ADD COLUMN "maxFirstName" TEXT;
ALTER TABLE "User" ADD COLUMN "maxLastName" TEXT;
ALTER TABLE "User" ADD COLUMN "maxUsername" TEXT;
ALTER TABLE "User" ADD COLUMN "maxAvatarUrl" TEXT;
ALTER TABLE "User" ADD COLUMN "maxFullAvatarUrl" TEXT;
ALTER TABLE "User" ADD COLUMN "maxLinkedAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "maxLastSyncAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "maxBotStartedAt" DATETIME;

ALTER TABLE "UserPreferences" ADD COLUMN "maxNotificationsEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "UserPreferences" ADD COLUMN "maxNotifyNewTasks" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "UserPreferences" ADD COLUMN "maxNotifyDeadlines" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "UserPreferences" ADD COLUMN "maxNotifyResults" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "UserPreferences" ADD COLUMN "maxNotifyReturns" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "UserPreferences" ADD COLUMN "maxNotifyOrders" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "UserPreferences" ADD COLUMN "maxNotifySystem" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "LoginChallenge" ADD COLUMN "cancelledAt" DATETIME;
ALTER TABLE "LoginChallenge" ADD COLUMN "codeHash" TEXT;
ALTER TABLE "BotMessage" ADD COLUMN "sourceEventId" TEXT;
CREATE UNIQUE INDEX "BotMessage_sourceEventId_key" ON "BotMessage"("sourceEventId");

CREATE TABLE "FaqItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Общее',
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "FaqItem_isPublished_archivedAt_sortOrder_idx" ON "FaqItem"("isPublished", "archivedAt", "sortOrder");
CREATE INDEX "FaqItem_category_isPublished_archivedAt_idx" ON "FaqItem"("category", "isPublished", "archivedAt");
