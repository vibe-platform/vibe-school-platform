ALTER TABLE "LedgerEntry" ADD COLUMN "rewardPolicyVersion" TEXT;
ALTER TABLE "LedgerEntry" ADD COLUMN "rewardGradeSnapshot" INTEGER;
ALTER TABLE "LedgerEntry" ADD COLUMN "rewardBaseAmount" INTEGER;
ALTER TABLE "LedgerEntry" ADD COLUMN "rewardDayKey" TEXT;
ALTER TABLE "LedgerEntry" ADD COLUMN "rewardMultiplierTenths" INTEGER;
ALTER TABLE "LedgerEntry" ADD COLUMN "rewardTargetAmount" INTEGER;
