import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { sha256 } from "../apps/api/src/security.js";

test("public legal pages render in both themes and fit a phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem("vibe-theme-mode", "light"));
  for (const [path, heading] of [
    ["/legal", "Правовая информация"],
    ["/legal/owner", "Сведения о владельце сайта"],
    ["/legal/privacy", "Политика обработки персональных данных"],
    ["/legal/personal-data-consent", "Согласие на обработку персональных данных"],
    ["/legal/terms", "Пользовательское соглашение"],
    ["/legal/privacy-request", "Обращение по вопросам персональных данных"],
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    if (path === "/legal") {
      await expect(page.locator(".legal-toc")).toHaveCount(0);
      await expect(page.locator(".legal-card-grid .legal-card")).toHaveCount(5);
      await expect(page.locator(".legal-footer nav")).toContainText("Пользовательское соглашение");
      await expect(page.locator(".legal-footer nav")).toContainText("Поддержка: vaibe32@mail.ru");
      const heading = await page.locator(".legal-heading").boundingBox();
      const cards = await page.locator(".legal-card-grid").boundingBox();
      expect(heading && cards && cards.y).toBeGreaterThanOrEqual((heading?.y ?? 0) + (heading?.height ?? 0));
    } else {
      expect(await page.locator(".legal-toc a").count()).toBeGreaterThan(0);
    }
    if (path === "/legal/privacy-request") {
      await page.getByLabel("Контакт для ответа").fill("person@example.invalid");
      await page.getByRole("button", { name: "Скачать обращение" }).click();
      await expect(page.getByRole("status")).toContainText("Черновик скачан");
    }
  }
  await page.addInitScript(() => localStorage.setItem("vibe-theme-mode", "dark"));
  await page.goto("/legal/privacy");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("heading", { name: "Политика обработки персональных данных", level: 1 })).toBeVisible();
  await expect(page.locator(".legal-document-body")).toContainText("Сроки хранения");
  await expect(page.locator(".legal-document-body")).toContainText("MAX");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("real-account legal acknowledgement is separate, server-timed, repeat-safe, and persists across logout/login", async ({ page, baseURL }) => {
  const db = new PrismaClient();
  const consentRequired = process.env.LEGAL_PD_CONSENT_REQUIRED === "true";
  const appOrigin = new URL(baseURL ?? "http://127.0.0.1:5174").origin;
  const maxUserId = `992${Date.now()}`;
  const otherMaxUserId = `993${Date.now()}`;
  let userId = "";
  let otherUserId = "";
  await page.setViewportSize({ width: 1280, height: 900 });
  try {
    const user = await db.user.create({ data: { maxUserId, firstName: "Тест", lastName: "Правовой" } });
    userId = user.id;
    const other = await db.user.create({ data: { maxUserId: otherMaxUserId, firstName: "Другой", lastName: "Профиль" } });
    otherUserId = other.id;
    const csrf = randomBytes(24).toString("base64url");
    const issueSession = async () => {
      const token = randomBytes(32).toString("base64url");
      await db.session.create({ data: { userId: user.id, authSource: "MAX", tokenHash: sha256(token), expiresAt: new Date(Date.now() + 60 * 60_000) } });
      await page.context().addCookies([
        { name: "vibe_session", value: token, url: appOrigin, httpOnly: true, sameSite: "Strict" },
        { name: "vibe_csrf", value: csrf, url: appOrigin, sameSite: "Strict" },
      ]);
    };

    await issueSession();
    await page.goto("/tasks");
    const gate = page.getByRole("dialog", { name: "Проверьте документы" });
    await expect(gate).toBeVisible();
    await expect(gate.getByText("Я ознакомился с Пользовательским соглашением")).toBeVisible();
    await expect(gate.getByText("Я даю отдельное согласие на обработку персональных данных")).toHaveCount(consentRequired ? 1 : 0);
    await expect(gate.getByRole("button", { name: "Продолжить" })).toBeDisabled();

    const forged = await page.request.post("/api/legal/acceptance", { data: { termsAccepted: true, userId: other.id, acceptedAt: "2000-01-01" }, headers: { "x-csrf-token": csrf } });
    expect(forged.status()).toBe(400);
    expect(await db.legalAcceptance.count({ where: { userId: other.id } })).toBe(0);

    const documentChoices = gate.locator(".legal-consent-choice input");
    await documentChoices.first().check();
    if (consentRequired) await documentChoices.nth(1).check();
    await gate.getByRole("button", { name: "Продолжить" }).click();
    await expect(gate).toHaveCount(0);
    const accepted = await db.legalAcceptance.findFirstOrThrow({ where: { userId: user.id, documentType: "TERMS" } });
    expect(accepted).toMatchObject({ source: "MAX", consentStatus: "ACKNOWLEDGED" });
    expect(accepted.acceptedAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(await db.legalAcceptance.count({ where: { userId: user.id, documentType: "TERMS" } })).toBe(1);
    if (consentRequired) {
      const consent = await db.legalAcceptance.findFirstOrThrow({ where: { userId: user.id, documentType: "PERSONAL_DATA_CONSENT" } });
      expect(consent).toMatchObject({ source: "MAX", documentVersion: "2.0 · 01.11.2026", consentStatus: "GRANTED" });
    }

    await page.getByRole("button", { name: "Открыть главное меню" }).click();
    await page.getByRole("button", { name: /Завершить сеанс/u }).click();
    await expect(page.locator(".login-card")).toBeVisible();
    await issueSession();
    await page.goto("/tasks");
    await expect(page.getByRole("dialog", { name: "Проверьте документы" })).toHaveCount(0);
    expect(await db.legalAcceptance.count({ where: { userId: other.id } })).toBe(0);
  } finally {
    await db.user.deleteMany({ where: { id: { in: [userId, otherUserId].filter(Boolean) } } });
    await db.$disconnect();
  }
});
