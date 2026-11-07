ALTER TABLE "LegalSettings" DROP COLUMN "serverLocationConfirmed";
ALTER TABLE "LegalSettings" DROP COLUMN "roskomnadzorNotificationStatus";

ALTER TABLE "LegalSettings" ADD COLUMN "serverLocation" TEXT;
ALTER TABLE "LegalSettings" ADD COLUMN "dataPurposes" TEXT;
ALTER TABLE "LegalSettings" ADD COLUMN "dataCategories" TEXT;
ALTER TABLE "LegalSettings" ADD COLUMN "dataLegalBasis" TEXT;
ALTER TABLE "LegalSettings" ADD COLUMN "dataRecipients" TEXT;
ALTER TABLE "LegalSettings" ADD COLUMN "retentionPeriods" TEXT;
ALTER TABLE "LegalSettings" ADD COLUMN "childrenDataProcedure" TEXT;
ALTER TABLE "LegalSettings" ADD COLUMN "securityMeasures" TEXT;
ALTER TABLE "LegalSettings" ADD COLUMN "consentPurposes" TEXT;
ALTER TABLE "LegalSettings" ADD COLUMN "consentDataCategories" TEXT;
ALTER TABLE "LegalSettings" ADD COLUMN "consentActions" TEXT;
ALTER TABLE "LegalSettings" ADD COLUMN "consentRecipients" TEXT;
ALTER TABLE "LegalSettings" ADD COLUMN "consentDuration" TEXT;
ALTER TABLE "LegalSettings" ADD COLUMN "consentRevocation" TEXT;
ALTER TABLE "LegalSettings" ADD COLUMN "consentVersion" TEXT;
