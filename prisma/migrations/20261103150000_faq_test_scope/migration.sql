ALTER TABLE "FaqItem" ADD COLUMN "isSynthetic" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "FaqItem_isSynthetic_isPublished_archivedAt_sortOrder_idx"
ON "FaqItem"("isSynthetic", "isPublished", "archivedAt", "sortOrder");
