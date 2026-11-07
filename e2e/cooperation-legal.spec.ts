import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

async function enterProfile(page: import("@playwright/test").Page, number: number) {
  await page.goto("/");
  await expect(page.locator(".app-frame, .login-page").first()).toBeVisible();
  if (await page.locator(".app-frame").count()) {
    await page.getByRole("button", { name: "Открыть главное меню" }).click();
    const logoutResponsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/auth/logout");
    await page.getByRole("button", { name: "Завершить сеанс" }).click();
    expect((await logoutResponsePromise).ok()).toBeTruthy();
  }
  await expect(page.getByRole("button", { name: "Тест" })).toBeVisible();
  await page.getByRole("button", { name: "Тест" }).click();
  await page.getByRole("button", { name: new RegExp(`Пользователь ${number}`, "u") }).click();
  const route = number === 2 ? "/teacher" : number === 3 ? "/admin" : number === 4 ? "/owner/schools" : "/tasks";
  await page.waitForURL(new RegExp(`${route.replaceAll("/", "\\/")}$`, "u"));
  await expect(page.locator(".app-frame")).toBeVisible();
}

async function csrf(page: import("@playwright/test").Page) {
  return page.evaluate(() => decodeURIComponent(document.cookie.match(/(?:^|; )vibe_csrf=([^;]+)/u)?.[1] ?? ""));
}

test("test owner can fill a private legal draft and publish a partner without a meeting section", async ({ page, baseURL }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await enterProfile(page, 4);
  await expect(page).toHaveURL(/\/owner\/schools$/u);
  await page.goto("/owner/legal");
  await expect(page.getByRole("heading", { name: "Юридическая информация" })).toBeVisible();
  const legalInputs: Array<[string, string]> = [
    ["Полное наименование организации или ФИО владельца", "Проверочное значение в одноразовой e2e-базе"],
    ["Краткое наименование", "Тестовый проект"], ["Адрес владельца", "Учебный адрес, 1"], ["Место нахождения", "Москва"],
    ["ИНН", "1234567890"], ["ОГРН или ОГРНИП", "1234567890123"], ["Email для общих обращений", "owner@example.invalid"],
    ["Email по вопросам персональных данных", "privacy@example.invalid"], ["Домен сайта", "vaibe32.ru"],
    ["Провайдер размещения", "Тестовый провайдер"], ["Страна и место размещения данных", "Учебная площадка"],
  ];
  for (const [label, value] of legalInputs) await page.getByRole("textbox", { name: label }).fill(value);
  await expect(page.getByRole("textbox", { name: "Цели обработки данных" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Текст согласия" })).toHaveCount(0);
  await expect(page.getByText("Перед запуском", { exact: false })).toHaveCount(0);
  await page.getByRole("button", { name: "Сохранить сведения" }).click();
  await expect(page.locator(".toast")).toContainText("Черновик тестового владельца сохранён");
  await page.reload();
  for (const [label, value] of legalInputs) await expect(page.getByRole("textbox", { name: label })).toHaveValue(value);
  await expect(page.getByText("не меняет документы для остальных пользователей")).toBeVisible();
  const publicSettings = await fetch(new URL("/api/legal/settings", baseURL ?? "http://127.0.0.1:5174")).then((response) => response.json());
  expect(publicSettings.organizationFullName).not.toBe("Проверочное значение в одноразовой e2e-базе");
  await page.goto("/legal/owner");
  await expect(page.locator(".legal-document-body")).toContainText("Проверочное значение в одноразовой e2e-базе");
  await expect(page.locator(".legal-heading .eyebrow")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.goto("/legal/privacy");
  const privacy = page.locator(".legal-document-body");
  await expect(privacy).toContainText("содержание учебных заданий");
  await expect(privacy).toContainText("имя пользователя");
  await expect(privacy).toContainText("MAX");
  await expect(privacy).toContainText("vaibe32@mail.ru");
  await expect(privacy).toContainText("законный представитель");
  await expect(privacy).not.toContainText(/DATABASE_URL|UPLOAD_DIR|HttpOnly|Роскомнадзор|placeholder|перед запуском|\.env/iu);
  await page.goto("/legal/terms");
  await expect(page.locator(".legal-document-body")).not.toContainText(/DATABASE_URL|UPLOAD_DIR|HttpOnly|Роскомнадзор|placeholder|перед запуском|\.env/iu);
  await page.goto("/legal/personal-data-consent");
  const consent = page.locator(".legal-document-body");
  await expect(consent).toContainText("Цель согласия");
  await expect(consent).toContainText("Перечень данных");
  await expect(consent).toContainText("Действия с данными");
  await expect(consent).toContainText("Срок действия и отзыв");
  await expect(consent).toContainText("privacy@example.invalid");
  await expect(consent).not.toContainText(/DATABASE_URL|UPLOAD_DIR|HttpOnly|Роскомнадзор|placeholder|перед запуском|\.env/iu);
  await page.goto("/owner/partners");
  await page.getByRole("button", { name: "Добавить точку" }).first().click();
  await page.getByLabel("Название организации *").fill("Одноразовая e2e-точка");
  await page.getByLabel("Краткое описание").fill("Проверочная карточка в одноразовой браузерной базе.");
  await expect(page.getByRole("heading", { name: "Встреча" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Договор" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Расположение" })).toBeVisible();
  await page.getByLabel(/Опубликовать в публичной ленте/u).check();
  await page.getByRole("button", { name: "Сохранить изменения" }).click();
  await expect(page.locator(".toast")).toContainText("Точка сотрудничества сохранена");
  await page.reload();
  await expect(page.getByText("Одноразовая e2e-точка")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  await page.goto("/partners");
  await expect(page.getByRole("heading", { name: "Сотрудничество" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Одноразовая e2e-точка" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Встреча" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  const db = new PrismaClient();
  let publicPartnerId = "";
  try {
    const publicPartner = await db.cooperationPartner.create({ data: { name: "Проверочная точка во временной базе", shortDescription: "Запись создана только для изолированной браузерной проверки.", isPublished: true, isSynthetic: false, sortOrder: 99999 } });
    publicPartnerId = publicPartner.id;
    await page.goto("/");
    await page.getByRole("button", { name: "Открыть главное меню" }).click();
    await page.getByRole("button", { name: "Завершить сеанс" }).click();
    await expect(page.locator(".login-card")).toBeVisible();
    const anonymousPartners = await page.request.get("/api/partners");
    expect(anonymousPartners.ok()).toBeTruthy();
    expect(await anonymousPartners.json()).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Проверочная точка во временной базе" })]));
    await page.goto("/partners");
    await expect(page.getByRole("heading", { name: "Проверочная точка во временной базе" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Встреча" })).toHaveCount(0);
  } finally {
    if (publicPartnerId) await db.cooperationPartner.delete({ where: { id: publicPartnerId } }).catch(() => undefined);
    await db.$disconnect();
  }

  const forbidden = async (profileNumber: number) => {
    await enterProfile(page, profileNumber);
    const token = await csrf(page);
    const legal = await page.request.put("/api/owner/legal-settings", { headers: { "x-csrf-token": token }, data: {} });
    const cooperation = await page.request.post("/api/owner/partners", { headers: { "x-csrf-token": token }, data: {} });
    expect(legal.status(), `profile ${profileNumber} cannot edit legal settings`).toBe(403);
    expect(cooperation.status(), `profile ${profileNumber} cannot create cooperation content`).toBe(403);
    const publicList = await page.request.get("/api/partners");
    expect(publicList.ok()).toBeTruthy();
    expect(await publicList.json()).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Одноразовая e2e-точка" })]));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  };
  await forbidden(1);
  await forbidden(2);
  await forbidden(3);

  await enterProfile(page, 4);
  await page.goto("/owner/partners");
  const ownerPartner = page.locator(".owner-partner-row").filter({ hasText: "Одноразовая e2e-точка" });
  await ownerPartner.getByRole("button", { name: "В архив" }).click();
  await expect(page.getByRole("dialog", { name: "Убрать точку из публикаций?" })).toBeVisible();
  await page.getByRole("button", { name: "Убрать в архив" }).click();
  await expect(page.locator(".toast")).toContainText("сохранена в архиве");
  await page.goto("/partners");
  await expect(page.getByText("Одноразовая e2e-точка")).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/owner/legal");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
  expect(errors).toEqual([]);
});

test("teacher accepts short valid assignment title, subject, and question text", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await enterProfile(page, 2);
  await page.goto("/teacher");
  await page.getByRole("button", { name: "Создать работу" }).click();
  await page.getByRole("button", { name: "Опубликовать работу" }).click();
  await expect(page.getByRole("alert")).toContainText("Поле «Название» пустое");
  await page.getByLabel("Название").fill("ДЗ");
  await page.getByLabel("Предмет").fill("ИТ");
  await page.getByLabel("Описание и условия").fill("§12");
  await page.getByRole("checkbox", { name: "7A" }).check();
  const question = page.locator(".composer-question").first();
  await question.getByLabel("Тип вопроса").selectOption("SINGLE_CHOICE");
  await question.getByLabel("Условие").fill("§12");
  await question.getByLabel("Варианты ответа · через запятую").fill("12");
  await question.getByLabel("Правильный ответ(ы)").fill("12");
  await page.getByRole("button", { name: "Опубликовать работу" }).click();
  await expect(page.getByRole("alert")).toContainText("Вопрос 1: для типа «Один вариант» нужно от 2 до 8 вариантов");
  await question.getByLabel("Варианты ответа · через запятую").fill("12, 13");
  await question.getByLabel("Правильный ответ(ы)").fill("");
  await page.getByRole("button", { name: "Опубликовать работу" }).click();
  await expect(page.getByRole("alert")).toContainText("Вопрос 1: правильный ответ не заполнен");
  await question.getByLabel("Правильный ответ(ы)").fill("12");
  await page.route("**/api/teacher/assignments", (route) => route.request().method() === "POST"
    ? route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Выбранный класс не закреплён за вашим профилем учителя. Снимите его выбор или попросите администратора школы назначить вас учителем этого класса, затем повторите публикацию." }) })
    : route.continue());
  await page.getByRole("button", { name: "Опубликовать работу" }).click();
  await expect(page.getByRole("alert")).toContainText("попросите администратора школы назначить вас учителем этого класса");
  await expect(page.getByLabel("Название")).toHaveValue("ДЗ");
  await page.unroute("**/api/teacher/assignments");
  await page.getByRole("button", { name: "Опубликовать работу" }).click();
  await expect(page.locator(".toast").first()).toContainText("Работа опубликована");
  const assignments = await page.request.get("/api/teacher/assignments").then((response) => response.json());
  expect(assignments).toEqual(expect.arrayContaining([expect.objectContaining({ title: "ДЗ", subject: "ИТ" })]));
});
