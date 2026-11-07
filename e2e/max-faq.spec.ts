import { expect, test } from "@playwright/test";

async function enterProfile(page: import("@playwright/test").Page, profile: 1 | 4) {
  await page.goto("/");
  await expect(page.locator(".app-frame, .login-page").first()).toBeVisible();
  if (await page.locator(".app-frame").count()) {
    await page.getByRole("button", { name: "Открыть главное меню" }).click();
    const logout = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/auth/logout");
    await page.getByRole("button", { name: "Завершить сеанс" }).click();
    expect((await logout).ok()).toBeTruthy();
  }
  await expect(page.getByRole("button", { name: "Тест" })).toBeVisible();
  await page.getByRole("button", { name: "Тест" }).click();
  await page.getByRole("dialog").getByRole("button", { name: new RegExp(`Пользователь ${profile}`, "u") }).click();
  const route = profile === 4 ? "/owner/schools" : "/tasks";
  await page.waitForURL(new RegExp(`${route.replaceAll("/", "\\/")}$`, "u"), { waitUntil: "domcontentloaded" });
  await expect(page.locator(".app-frame")).toBeVisible();
}

test("owner FAQ lifecycle and MAX status API work without real MAX credentials", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const suffix = Date.now().toString(36);
  const question = `Проверочный вопрос ${suffix}`;
  const editedQuestion = `Обновлённый вопрос ${suffix}`;

  await enterProfile(page, 4);
  await page.goto("/owner/faq");
  await expect(page.getByRole("heading", { name: "Вопросы и ответы" })).toBeVisible();
  await page.locator(".faq-editor").getByRole("textbox", { name: "Вопрос" }).fill(question);
  await page.locator(".faq-editor").getByRole("textbox", { name: "Ответ" }).fill("Проверочный ответ сохраняется в одноразовой базе.");
  await page.locator(".faq-editor").getByRole("textbox", { name: "Категория" }).fill("Проверка браузера");
  await page.locator(".faq-editor input[type=checkbox]").nth(1).check();
  await page.getByRole("button", { name: "Создать ответ" }).click();
  await expect(page.locator(".toast")).toContainText("Ответ сохранён");

  await page.reload();
  const created = page.locator(".faq-owner-item").filter({ hasText: question });
  await expect(created).toContainText("Опубликован");
  await page.goto("/faq");
  await page.getByLabel("Найти вопрос или ответ").fill(question);
  const publicAnswer = page.locator(".faq-item").filter({ hasText: question });
  await expect(publicAnswer).toBeVisible();
  await publicAnswer.locator("summary").click();
  await expect(publicAnswer).toContainText("Проверочный ответ сохраняется в одноразовой базе.");

  await page.goto("/owner/faq");
  await page.locator(".faq-owner-item").filter({ hasText: question }).getByRole("button", { name: "Изменить" }).click();
  await page.locator(".faq-editor").getByRole("textbox", { name: "Вопрос" }).fill(editedQuestion);
  await page.locator(".faq-editor").getByRole("textbox", { name: "Ответ" }).fill("Исправленный проверочный ответ.");
  await page.getByRole("button", { name: "Сохранить изменения" }).click();
  await expect(page.locator(".toast")).toContainText("Ответ сохранён");
  await page.reload();
  const edited = page.locator(".faq-owner-item").filter({ hasText: editedQuestion });
  await expect(edited).toContainText("Опубликован");
  await edited.getByRole("button", { name: "В архив" }).click();
  await expect(page.locator(".toast")).toContainText("Статус ответа обновлён");
  await page.getByRole("button", { name: "Показать архив" }).click();
  const archived = page.locator(".faq-owner-item").filter({ hasText: editedQuestion });
  await expect(archived).toContainText("Архив");
  await archived.getByRole("button", { name: "Восстановить" }).click();
  await expect(page.locator(".toast")).toContainText("Статус ответа обновлён");
  await expect(archived).toContainText("Черновик");
  await page.goto("/faq");
  await page.getByLabel("Найти вопрос или ответ").fill(editedQuestion);
  await expect(page.getByText("По выбранному запросу опубликованных ответов не найдено.")).toBeVisible();

  const status = await page.request.get("/api/owner/max/status");
  expect(status.status()).toBe(403);

  await enterProfile(page, 1);
  await page.getByRole("button", { name: "Открыть главное меню" }).click();
  await page.getByRole("button", { name: "Настройки" }).click();
  await expect(page.getByRole("dialog", { name: "Настройки" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Разрешить уведомления в MAX" })).toHaveCount(0);
  await expect(page.getByText("Свяжи аккаунт с MAX")).toBeVisible();

  const forbidden = await page.request.get("/api/owner/max/status");
  expect(forbidden.status()).toBe(403);
});
