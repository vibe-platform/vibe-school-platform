import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "./db.js";
import { authenticate, requireAuth } from "./security.js";

const documentTitles = {
  TERMS: "Пользовательское соглашение",
  PERSONAL_DATA_CONSENT: "Согласие на обработку персональных данных",
} as const;

const defaultVersions = {
  TERMS: "1.1 · 01.11.2026",
  PRIVACY: "2.0 · 01.11.2026",
  PERSONAL_DATA_CONSENT: "2.0 · 01.11.2026",
} as const;

export const personalDataConsentRequired = () => process.env.LEGAL_PD_CONSENT_REQUIRED === "true";
const acceptanceSchema = z.object({ termsAccepted: z.literal(true), personalDataConsent: z.boolean().default(false) }).strict();

const legalSettingsInput = z.object({
  organizationFullName: z.string().trim().max(240).nullable(),
  organizationShortName: z.string().trim().max(120).nullable(),
  legalAddress: z.string().trim().max(500).nullable(),
  location: z.string().trim().max(240).nullable(),
  inn: z.string().trim().max(20).nullable(),
  ogrn: z.string().trim().max(20).nullable(),
  generalEmail: z.string().trim().max(254).nullable(),
  privacyEmail: z.string().trim().max(254).nullable(),
  domain: z.string().trim().max(253).nullable(),
  hostingProvider: z.string().trim().max(240).nullable(),
  serverLocation: z.string().trim().max(500).nullable(),
}).strict();

const emptyLegalSettings = {
  id: "main",
  organizationFullName: null,
  organizationShortName: null,
  legalAddress: null,
  location: null,
  inn: null,
  ogrn: null,
  generalEmail: null,
  privacyEmail: null,
  domain: null,
  hostingProvider: null,
  serverLocation: null,
};

const factualFields = [
  "organizationFullName", "organizationShortName", "legalAddress", "location", "inn", "ogrn",
  "generalEmail", "privacyEmail", "domain", "hostingProvider", "serverLocation",
] as const;

type FactualLegalSettings = { [Key in typeof factualFields[number]]: string | null };

function settingsDto(values: FactualLegalSettings, fields: readonly (typeof factualFields)[number][]) {
  return Object.fromEntries(fields.map((field) => [field, values[field]]));
}

async function sharedLegalSettings() {
  const [main, previousOwnerSettings] = await Promise.all([
    prisma.legalSettings.findUnique({ where: { id: "main" } }),
    prisma.legalSettings.findUnique({ where: { id: "test" } }),
  ]);
  if (!previousOwnerSettings) return main;
  const values = Object.fromEntries(factualFields.map((field) => [field, main?.[field]?.trim() || previousOwnerSettings[field]?.trim() || null])) as FactualLegalSettings;
  if (!main || factualFields.some((field) => !main[field]?.trim() && Boolean(previousOwnerSettings[field]?.trim()))) {
    return prisma.legalSettings.upsert({
      where: { id: "main" },
      create: { id: "main", ...values, updatedById: previousOwnerSettings.updatedById },
      update: { ...values, updatedById: main?.updatedById ?? previousOwnerSettings.updatedById },
    });
  }
  return main;
}

async function requireLegalSettingsOwner(request: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) {
  const context = await requireAuth(request, reply);
  if (!context) return null;
  if (context.user.platformRole !== "PROJECT_OWNER") {
    await reply.code(403).send({ error: "Нет доступа к юридическим сведениям" });
    return null;
  }
  return context;
}

async function currentVersions() {
  const settings = await prisma.legalSettings.findUnique({ where: { id: "main" }, select: { termsVersion: true } });
  return {
    TERMS: settings?.termsVersion?.trim() || defaultVersions.TERMS,
    PERSONAL_DATA_CONSENT: defaultVersions.PERSONAL_DATA_CONSENT,
  };
}

export async function registerLegalRoutes(app: FastifyInstance) {
  app.get("/api/legal/settings", async (request) => {
    const settings = await sharedLegalSettings();
    const versions = await currentVersions();
    return {
      ...settingsDto(settings ?? emptyLegalSettings, factualFields),
      generalEmail: settings?.generalEmail?.trim() || "vaibe32@mail.ru",
      privacyEmail: settings?.privacyEmail?.trim() || "vaibe32@mail.ru",
      domain: settings?.domain?.trim() || "vaibe32.ru",
      privacyVersion: defaultVersions.PRIVACY,
      termsVersion: versions.TERMS,
      consentVersion: versions.PERSONAL_DATA_CONSENT,
    };
  });

  app.get("/api/owner/legal-settings", async (request, reply) => {
    const context = await requireLegalSettingsOwner(request, reply);
    if (!context) return;
    const settings = await sharedLegalSettings();
    return { ...settingsDto(settings ?? emptyLegalSettings, factualFields), isDraft: false };
  });

  app.put("/api/owner/legal-settings", async (request, reply) => {
    const context = await requireLegalSettingsOwner(request, reply);
    if (!context) return;
    const parsed = legalSettingsInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Проверьте заполненные сведения" });
    const input = parsed.data;
    for (const [key, value] of Object.entries(input)) {
      if (typeof value === "string" && value.length === 0) (input as Record<string, unknown>)[key] = null;
    }
    if (input.generalEmail && !z.string().email().safeParse(input.generalEmail).success) return reply.code(400).send({ error: "Проверьте email для общих обращений" });
    if (input.privacyEmail && !z.string().email().safeParse(input.privacyEmail).success) return reply.code(400).send({ error: "Проверьте email по вопросам персональных данных" });
    if (input.domain && !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/iu.test(input.domain)) return reply.code(400).send({ error: "Укажите домен без протокола, например example.ru" });
    await sharedLegalSettings();
    const settingsId = "main";
    const saved = await prisma.legalSettings.upsert({ where: { id: settingsId }, create: { id: settingsId, ...input, updatedById: context.user.id }, update: { ...input, updatedById: context.user.id } });
    return { ...settingsDto(saved, factualFields), isDraft: false };
  });

  app.get("/api/legal/acceptance", async (request) => {
    const context = await authenticate(request);
    if (!context) return { authenticated: false, source: null, required: [], accepted: [] };
    const versions = await currentVersions();
    const requiredTypes = context.authSource === "TEST"
      ? []
      : ["TERMS", ...(personalDataConsentRequired() ? ["PERSONAL_DATA_CONSENT"] : [])] as Array<keyof typeof documentTitles>;
    const accepted = await prisma.legalAcceptance.findMany({
      where: { userId: context.user.id, documentType: { in: [...Object.keys(documentTitles)] }, documentVersion: { in: Object.values(versions) } },
      orderBy: { acceptedAt: "desc" },
    });
    const statusFor = (documentType: keyof typeof documentTitles) => documentType === "TERMS" ? "ACKNOWLEDGED" : "GRANTED";
    const currentAccepted = (documentType: keyof typeof documentTitles) => accepted.find((row) => row.documentType === documentType && row.documentVersion === versions[documentType] && !row.revokedAt && row.consentStatus === statusFor(documentType));
    const required = requiredTypes.filter((documentType) => !currentAccepted(documentType)).map((documentType) => ({ type: documentType, version: versions[documentType], title: documentTitles[documentType] }));
    return {
      authenticated: true,
      source: context.authSource,
      consentRequired: personalDataConsentRequired() && context.authSource !== "TEST",
      currentVersions: versions,
      required,
      accepted: accepted.map((row) => ({ documentType: row.documentType, documentVersion: row.documentVersion, consentStatus: row.consentStatus, acceptedAt: row.acceptedAt, revokedAt: row.revokedAt })),
    };
  });

  app.post("/api/legal/acceptance", async (request, reply) => {
    const context = await requireAuth(request, reply);
    if (!context) return;
    if (context.authSource === "TEST") return reply.code(403).send({ error: "Для тестовых профилей принятие документов не записывается" });
    const parsed = acceptanceSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Подтвердите ознакомление с Пользовательским соглашением" });
    if (personalDataConsentRequired() && !parsed.data.personalDataConsent) return reply.code(400).send({ error: "Для продолжения требуется отдельное согласие на обработку персональных данных" });
    if (!personalDataConsentRequired() && parsed.data.personalDataConsent) return reply.code(400).send({ error: "Отдельное согласие сейчас не запрашивается" });

    const versions = await currentVersions();
    await prisma.$transaction(async (tx) => {
      const save = async (documentType: keyof typeof documentTitles, consentStatus: "ACKNOWLEDGED" | "GRANTED") => {
        const documentVersion = versions[documentType];
        const where = { userId_documentType_documentVersion: { userId: context.user.id, documentType, documentVersion } };
        const existing = await tx.legalAcceptance.findUnique({ where });
        if (existing && existing.consentStatus === consentStatus && !existing.revokedAt) return;
        await tx.legalAcceptance.upsert({ where, create: { userId: context.user.id, documentType, documentVersion, source: context.authSource, consentStatus }, update: { source: context.authSource, consentStatus, acceptedAt: new Date(), revokedAt: null } });
      };
      await save("TERMS", "ACKNOWLEDGED");
      if (personalDataConsentRequired()) await save("PERSONAL_DATA_CONSENT", "GRANTED");
    });
    return { ok: true };
  });

  app.post("/api/legal/personal-data-consent/revoke", async (request, reply) => {
    const context = await requireAuth(request, reply);
    if (!context) return;
    if (context.authSource === "TEST") return reply.code(403).send({ error: "Для тестовых профилей согласия не записываются" });
    const versions = await currentVersions();
    const row = await prisma.legalAcceptance.findUnique({ where: { userId_documentType_documentVersion: { userId: context.user.id, documentType: "PERSONAL_DATA_CONSENT", documentVersion: versions.PERSONAL_DATA_CONSENT } } });
    if (!row || row.consentStatus !== "GRANTED" || row.revokedAt) return reply.code(409).send({ error: "Действующее согласие для этой редакции не найдено" });
    await prisma.legalAcceptance.update({ where: { id: row.id }, data: { consentStatus: "REVOKED", revokedAt: new Date() } });
    return { ok: true };
  });
}
