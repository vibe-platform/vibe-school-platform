import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

test("MAX avatar image loads when available and falls back to initials when expired", async ({ page }) => {
  const prisma = new PrismaClient();
  let userId = "";
  let originalAvatarUrl: string | null = null;
  try {
    const student = await prisma.user.findUniqueOrThrow({ where: { testProfileKey: "user-1" }, select: { id: true, avatarUrl: true } });
    userId = student.id;
    originalAvatarUrl = student.avatarUrl;
    await prisma.user.update({ where: { id: userId }, data: { avatarUrl: "https://cdn.max.example/avatar.png" } });

    const avatarImage = readFileSync(resolve(process.cwd(), "apps/web/public/brand/vibe-logo.png"));
    await page.route("https://cdn.max.example/avatar.png", (route) => route.fulfill({ status: 200, contentType: "image/png", body: avatarImage }));
    await page.route("https://cdn.max.example/expired-avatar.png", (route) => route.fulfill({ status: 200, contentType: "image/png", body: "not a valid PNG" }));

    await page.goto("/");
    await page.getByRole("button", { name: "Тест" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /Пользователь 1/u }).click();
    await page.waitForURL(/\/tasks$/u);
    await page.goto("/profile");

    const avatar = page.locator(".profile-preview .avatar-wrap");
    const image = avatar.locator("img");
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await expect(image).toHaveAttribute("referrerpolicy", "no-referrer");

    await prisma.user.update({ where: { id: userId }, data: { avatarUrl: "https://cdn.max.example/expired-avatar.png" } });
    await page.reload();
    await expect(avatar.locator("img")).toHaveCount(0);
    await expect(avatar.locator("span")).toHaveText("П1");
  } finally {
    if (userId) await prisma.user.update({ where: { id: userId }, data: { avatarUrl: originalAvatarUrl } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});
