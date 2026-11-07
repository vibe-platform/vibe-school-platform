                                                                                    
ALTER TABLE "School" ADD COLUMN "archivedAt" DATETIME;
ALTER TABLE "School" ADD COLUMN "isSynthetic" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "School" ADD COLUMN "requestKey" TEXT;

DROP INDEX "School_name_key";
CREATE UNIQUE INDEX "School_name_city_key" ON "School"("name", "city");
CREATE UNIQUE INDEX "School_requestKey_key" ON "School"("requestKey");
CREATE INDEX "School_archivedAt_city_name_idx" ON "School"("archivedAt", "city", "name");

ALTER TABLE "SchoolClass" ADD COLUMN "normalizedName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SchoolClass" ADD COLUMN "archivedAt" DATETIME;
UPDATE "SchoolClass"
SET "normalizedName" = UPPER(TRIM(REPLACE(REPLACE(REPLACE(REPLACE("name", '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' ')));
DROP INDEX "SchoolClass_schoolId_name_key";
CREATE UNIQUE INDEX "SchoolClass_schoolId_normalizedName_key" ON "SchoolClass"("schoolId", "normalizedName");
CREATE INDEX "SchoolClass_schoolId_archivedAt_idx" ON "SchoolClass"("schoolId", "archivedAt");

ALTER TABLE "TeacherClass" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Product" ADD COLUMN "isSynthetic" BOOLEAN NOT NULL DEFAULT false;
