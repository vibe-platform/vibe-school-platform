import { expect, test } from "@playwright/test";

test("MAX logo is present and the test-profile sheet covers the page footer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const maxLogo = page.locator(".max-mark img");
  await expect(maxLogo).toHaveAttribute("src", "/brand/max-logo.png");
  await expect.poll(() => maxLogo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.getByRole("button", { name: "Тест" }).click();
  const dialog = page.getByRole("dialog", { name: "Тестовые профили" });
  await expect(dialog).toBeVisible();
  const footer = page.locator(".login-legal-footer");
  await footer.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const footerIsCovered = await page.evaluate(() => {
    const footerElement = document.querySelector(".login-legal-footer");
    const backdrop = document.querySelector(".modal-backdrop");
    if (!footerElement || !backdrop) return false;
    const rect = footerElement.getBoundingClientRect();
    const point = document.elementFromPoint(Math.max(0, rect.left + 4), Math.max(0, Math.min(window.innerHeight - 1, rect.top + 4)));
    return Boolean(point && !footerElement.contains(point) && (point === backdrop || backdrop.contains(point) || document.querySelector(".glass-modal")?.contains(point)));
  });
  expect(footerIsCovered).toBe(true);
});

test("site footer stays at the viewport bottom on short pages and follows long content", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.goto("/legal");
  const publicFooter = page.locator(".legal-site-footer");
  await expect(publicFooter).toBeVisible();
  const shortPage = await page.evaluate(() => ({
    footerBottom: document.querySelector(".legal-site-footer")!.getBoundingClientRect().bottom,
    viewportHeight: window.innerHeight,
    documentHeight: document.documentElement.scrollHeight,
  }));
  expect(shortPage.documentHeight).toBeLessThanOrEqual(shortPage.viewportHeight + 1);
  expect(Math.abs(shortPage.footerBottom - shortPage.viewportHeight)).toBeLessThanOrEqual(2);

  await page.setViewportSize({ width: 1280, height: 780 });
  await page.goto("/legal/terms");
  await expect(publicFooter).toBeVisible();
  const longDocumentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(longDocumentHeight).toBeGreaterThan(780);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const longPage = await page.evaluate(() => ({
    footerBottom: document.querySelector(".legal-site-footer")!.getBoundingClientRect().bottom,
    viewportHeight: window.innerHeight,
    scrollY: window.scrollY,
    documentHeight: document.documentElement.scrollHeight,
  }));
  expect(Math.abs(longPage.scrollY + longPage.footerBottom - longPage.documentHeight)).toBeLessThanOrEqual(2);

  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.goto("/");
  await page.getByRole("button", { name: "Тест" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Пользователь 4/u }).click();
  await page.waitForURL(/\/owner\/schools$/u);
  await page.goto("/owner");
  const appFooter = page.locator(".app-shell-footer");
  await expect(appFooter).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const appPage = await page.evaluate(() => ({
    footerBottom: document.querySelector(".app-shell-footer")!.getBoundingClientRect().bottom,
    scrollY: window.scrollY,
    documentHeight: document.documentElement.scrollHeight,
  }));
  expect(Math.abs(appPage.scrollY + appPage.footerBottom - appPage.documentHeight)).toBeLessThanOrEqual(2);
});
