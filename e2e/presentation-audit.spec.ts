import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { resolve } from "node:path";

test("four profiles, assignment photo lifecycle, grading, one-time reward, market, auth, and responsive controls", async ({ page }) => {
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/Failed to load resource: the server responded with a status of (?:400|403|415)/u.test(message.text())) pageErrors.push(message.text());
  });
  const classroomImage = resolve(process.cwd(), "apps/web/public/brand/vibe-logo.png");

  await page.setViewportSize({ width: 456, height: 844 });
  await page.goto("/");
  for (const width of [456, 520, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const story = await page.locator(".login-story").boundingBox();
    const loginCard = await page.locator(".login-card").boundingBox();
    const brand = await page.locator(".login-brand").boundingBox();
    expect(story, `mission panel at ${width}px`).not.toBeNull();
    expect(loginCard, `login panel at ${width}px`).not.toBeNull();
    expect(brand, `brand at ${width}px`).not.toBeNull();
    expect(story!.width, `mission panel width at ${width}px`).toBeGreaterThan(width * 0.75);
    expect(brand!.y + brand!.height, `brand must appear before sign in at ${width}px`).toBeLessThanOrEqual(loginCard!.y + 1);
    expect(loginCard!.y + loginCard!.height, `sign in must finish before mission at ${width}px`).toBeLessThanOrEqual(story!.y + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `no horizontal overflow at ${width}px`).toBeLessThanOrEqual(width);
    if (width === 456) await page.screenshot({ path: resolve(process.cwd(), "test-results/vibe-login-456.png"), fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const profilesResponse = await page.request.get("/api/auth/test/profiles");
  expect(profilesResponse.ok()).toBeTruthy();
  const profiles = await profilesResponse.json();
  expect(profiles).toHaveLength(4);
  expect(profiles.map((profile: { name: string }) => profile.name)).toEqual(["Пользователь 1", "Пользователь 2", "Пользователь 3", "Пользователь 4"]);
  expect(profiles.slice(0, 3).every((profile: { available: boolean; schoolName: string; className: string }) => profile.available && profile.schoolName === "Школа Вайб № 21" && profile.className === "7A")).toBeTruthy();
  expect(profiles[3]).toMatchObject({ role: "PROJECT_OWNER", available: true, schoolName: null, className: null });
  expect(await page.request.post("/api/auth/max", { data: { initData: "not-signed" } }).then((response) => response.status())).toBe(503);
  await page.getByRole("button", { name: "Войти через MAX" }).click();
  await expect(page.locator(".toast").first()).toContainText("MAX не подключён");
  expect(await page.locator("body").innerText()).not.toMatch(/Идея Фикс|Сферум|Демо-режим/u);
  const testTrigger = page.getByRole("button", { name: "Тест" });
  await testTrigger.click();
  const testDialog = page.getByRole("dialog");
  await expect(testDialog.getByRole("heading", { name: "Тестовые профили" })).toBeVisible();
  expect(await testDialog.locator(".test-profile-card").count()).toBe(4);
  await expect(testDialog).toContainText("Они не связаны с вашим аккаунтом MAX.");
  const firstTestProfile = testDialog.locator(".test-profile-card").first();
  await expect(firstTestProfile).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(firstTestProfile).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(testDialog).toHaveCount(0);
  await expect(testTrigger).toBeFocused();

  const signIn = async (profileName: string) => {
    if (await page.getByRole("button", { name: "Открыть главное меню" }).count()) {
      await page.getByRole("button", { name: "Открыть главное меню" }).click();
      await page.getByRole("button", { name: "Завершить сеанс" }).click();
    }
    await page.getByRole("button", { name: "Тест" }).click();
    const loginResponsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/auth/test/session");
    await page.getByRole("button", { name: new RegExp(profileName, "u") }).click();
    const loginResponse = await loginResponsePromise;
    const redirectTo = profileName === "Пользователь 2" ? "/teacher" : profileName === "Пользователь 3" ? "/admin" : profileName === "Пользователь 4" ? "/owner/schools" : "/tasks";
    await page.waitForURL(new RegExp(`${redirectTo}$`, "u"));
    await expect(page.locator(".app-frame")).toBeVisible();
    const sessionResponse = await page.request.get("/api/session/me");
    const sessionBody = await sessionResponse.json();
    expect(loginResponse.ok()).toBeTruthy();
    expect(sessionBody.user?.name).toBe(profileName);
    expect(sessionBody.user?.role).toBe(profileName === "Пользователь 2" ? "TEACHER" : profileName === "Пользователь 3" ? "SCHOOL_ADMIN" : profileName === "Пользователь 4" ? "PROJECT_OWNER" : "STUDENT");
    await expect(page.locator(".app-frame")).toBeVisible();
  };

  await signIn("Пользователь 2");
  await page.goto("/teacher");
  await page.getByRole("button", { name: "Создать работу" }).click();
  await page.getByRole("button", { name: "Опубликовать работу" }).click();
  await expect(page.getByRole("alert")).toContainText("Поле «Название» пустое. Введите название работы от 1 до 120 символов.");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Закрыть без сохранения" }).click();
  await page.getByRole("button", { name: "Создать работу" }).click();
  await page.getByLabel("Название").fill("Нулевой максимум · проверка формы");
  await page.getByLabel("Предмет").fill("Проверка");
  await page.getByLabel("Описание и условия").fill("Эта форма должна остаться черновиком только в браузере.");
  await page.getByRole("checkbox", { name: "7A" }).check();
  await page.locator(".composer-question").first().getByLabel("Условие").fill("Проверка положительного максимума баллов.");
  await page.locator(".composer-question").first().getByLabel("Правильный ответ(ы)").fill("1");
  const zeroMaximum = page.locator(".composer-question").first().getByLabel("Максимум баллов");
  await zeroMaximum.fill("0");
  await page.getByRole("button", { name: "Опубликовать работу" }).click();
  expect(await zeroMaximum.evaluate((input: HTMLInputElement) => input.validity.rangeUnderflow)).toBeTruthy();
  expect((await page.request.get("/api/teacher/assignments").then((response) => response.json())).some((assignment: { title: string }) => assignment.title === "Нулевой максимум · проверка формы")).toBeFalsy();
  await page.getByRole("button", { name: "Закрыть без сохранения" }).click();
  await page.getByRole("button", { name: "Создать работу" }).click();
  await page.getByLabel("Название").fill("Прошедший срок · проверка формы");
  await page.getByLabel("Предмет").fill("Проверка");
  await page.getByLabel("Описание и условия").fill("Срок в прошлом нельзя опубликовать.");
  await page.getByLabel("Общий срок").fill("2000-01-01T12:00");
  await page.getByRole("checkbox", { name: "7A" }).check();
  await page.locator(".composer-question").first().getByLabel("Условие").fill("Проверка даты публикации.");
  await page.locator(".composer-question").first().getByLabel("Правильный ответ(ы)").fill("1");
  await page.getByRole("button", { name: "Опубликовать работу" }).click();
  await expect(page.getByRole("alert")).toContainText("Срок сдачи уже прошёл. Выберите дату и время в будущем");
  expect((await page.request.get("/api/teacher/assignments").then((response) => response.json())).some((assignment: { title: string }) => assignment.title === "Прошедший срок · проверка формы")).toBeFalsy();
  await page.getByRole("button", { name: "Закрыть без сохранения" }).click();
  const createAutoTask = async (input: { title: string; type: "SHORT_TEXT" | "NUMBER" | "SINGLE_CHOICE"; prompt: string; acceptedAnswer: string; options?: string; tolerance?: string }) => {
    await page.goto("/teacher");
    await page.getByRole("button", { name: "Создать работу" }).click();
    await page.getByLabel("Название").fill(input.title);
    await page.getByLabel("Предмет").fill("Математика");
    await page.getByLabel("Описание и условия").fill("Браузерная проверка вопросов и автоматической оценки.");
    await page.getByRole("checkbox", { name: "7A" }).check();
    const question = page.locator(".composer-question").first();
    await question.getByLabel("Тип вопроса").selectOption(input.type);
    await question.getByLabel("Условие").fill(input.prompt);
    if (input.options) await question.getByLabel("Варианты ответа · через запятую").fill(input.options);
    if (input.tolerance) await question.getByLabel("Допустимая погрешность числа").fill(input.tolerance);
    await question.getByLabel("Правильный ответ(ы)").fill("");
    await page.getByRole("button", { name: "Опубликовать работу" }).click();
    await expect(page.getByRole("alert")).toContainText("Вопрос 1: правильный ответ не заполнен");
    await question.getByLabel("Правильный ответ(ы)").fill(input.acceptedAnswer);
    await page.getByRole("button", { name: "Опубликовать работу" }).click();
    await expect(page.locator(".toast").first()).toContainText("Работа опубликована");
  };
  await createAutoTask({ title: "Числовой ответ · аудит Вайба", type: "NUMBER", prompt: "Сколько будет 2,5 + 2,5?", acceptedAnswer: "5", tolerance: "0.2" });
  await createAutoTask({ title: "Один вариант · аудит Вайба", type: "SINGLE_CHOICE", prompt: "Какой цвет получится при смешении синего и жёлтого?", acceptedAnswer: "Зелёный", options: "Красный, Синий, Зелёный" });
  await createAutoTask({ title: "Нулевой ответ · аудит Вайба", type: "NUMBER", prompt: "Сколько будет 4 − 4?", acceptedAnswer: "0" });
  await createAutoTask({ title: "Альтернативный ответ · аудит Вайба", type: "SHORT_TEXT", prompt: "Назови второй вариант ответа.", acceptedAnswer: "Основной, Альтернативный" });
  await page.goto("/teacher");
  await expect(page.getByRole("heading", { name: "Кабинет учителя" })).toBeVisible();
  await page.getByRole("button", { name: "Создать работу" }).click();
  await page.getByLabel("Название").fill("Фото и проверка · аудит Вайба");
  await page.getByLabel("Предмет").fill("Окружающий мир");
  await page.getByLabel("Описание и условия").fill("Тестовый цикл: один быстрый ответ и фото развёрнутого решения.");
  await page.getByRole("checkbox", { name: "7A" }).check();
  await page.getByLabel("Прикрепить фото к заданию").setInputFiles(classroomImage);
  await expect(page.getByRole("img", { name: "Фото к заданию" })).toBeVisible();
  const invalidUploadResponsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/files" && response.request().method() === "POST");
  await page.getByLabel("Прикрепить фото к заданию").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: Buffer.from("<html>not a PNG image</html>") });
  expect((await invalidUploadResponsePromise).status()).toBe(415);
  await expect(page.getByRole("alert")).toContainText("Поддерживаются только корректные JPEG, PNG и WebP");
  await expect(page.getByRole("img", { name: "Фото к заданию" })).toHaveCount(1);
  await page.getByRole("button", { name: "Удалить фото к заданию" }).click();
  await expect(page.getByRole("img", { name: "Фото к заданию" })).toHaveCount(0);
  await page.getByLabel("Прикрепить фото к заданию").setInputFiles(classroomImage);
  await expect(page.getByRole("img", { name: "Фото к заданию" })).toBeVisible();
  await page.locator(".composer-question").nth(0).getByLabel("Условие").fill("Сколько будет 6 × 7?");
  await page.locator(".composer-question").nth(0).getByLabel("Правильный ответ(ы)").fill("42");
  await page.getByRole("button", { name: "Добавить вопрос" }).click();
  const longQuestion = page.locator(".composer-question").nth(1);
  await longQuestion.getByLabel("Тип вопроса").selectOption("LONG_ANSWER");
  await longQuestion.getByLabel("Условие").fill("Покажи на фото, как ты решил пример.");
  await longQuestion.getByLabel("Максимум баллов").fill("5");
  await page.getByRole("button", { name: "Опубликовать работу" }).click();
  await expect(page.locator(".toast").first()).toContainText("Работа опубликована");
  await page.getByRole("tab", { name: /Мои задания/u }).click();
  const assignmentCard = page.locator(".teacher-assignment-row").filter({ hasText: "Фото и проверка · аудит Вайба" });
  await expect(assignmentCard).toBeVisible();
  await expect(assignmentCard.getByText("Опубликовано")).toBeVisible();

  await signIn("Пользователь 1");
  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: "Задания" })).toBeVisible();
  const studentTaskList = await page.request.get("/api/tasks").then((response) => response.json());
  expect(studentTaskList.tasks.map((task: { title: string }) => task.title)).toContain("Фото и проверка · аудит Вайба");
  await page.getByRole("link", { name: "Открыть Фото и проверка · аудит Вайба", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Материалы задания" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Изображение к заданию" })).toBeVisible();
  await page.getByRole("button", { name: /Начать выполнение/u }).click();
  await page.locator(".answer-input input").fill("42");
  await page.getByLabel("Ответ на вопрос 2").fill("Пример решён, прикладываю фото.");
  await page.getByLabel("Добавить фото решения").setInputFiles(classroomImage);
  await expect(page.getByRole("img", { name: "Фото решения" })).toBeVisible();
  const submitResponse = page.waitForResponse((response) => {
    const path = new URL(response.url()).pathname;
    return path.startsWith("/api/tasks/") && path.endsWith("/submit") && response.request().method() === "POST";
  });
  await page.getByRole("button", { name: /Сдать работу/u }).click();
  const submitted = await submitResponse;
  expect(submitted.status(), await submitted.text()).toBe(200);
  await expect(page.getByRole("heading", { name: "Работа у учителя" })).toBeVisible();
  await expect(page.getByText("На проверке").first()).toBeVisible();
  await expect(page.request.get("/api/profile/customize").then((response) => response.json())).resolves.toMatchObject({ totalExp: 0, level: 1 });
  await expect(page.request.get("/api/market").then((response) => response.json())).resolves.toMatchObject({ balance: 0 });
  const pendingTasks = await page.request.get("/api/tasks").then((response) => response.json());
  expect(pendingTasks.waitingForReview).toBe(1);
  expect(pendingTasks.waitingForReviewDays).toBe(1);
  expect(pendingTasks.pendingActivityDays).toHaveLength(1);
  expect(await page.request.get("/api/profile").then((response) => response.json())).toMatchObject({ waitingForReview: 1, waitingForReviewDays: 1, streak: { current: 0 } });

  await signIn("Пользователь 2");
  await page.goto("/teacher");
  await expect(page.getByRole("heading", { name: "Фото и проверка · аудит Вайба" })).toBeVisible();
  await page.getByRole("button", { name: "Проверить работу" }).click();
  await expect(page.getByRole("img", { name: "Фото решения ученика" })).toBeVisible();
  const scoreFields = page.locator(".score-question input[type=number]");
  await scoreFields.nth(0).fill("7");
  await scoreFields.nth(1).fill("4");
  await page.getByLabel("Комментарий ученику").fill("Фото читаемое, решение верное.");
  await page.getByRole("button", { name: "Завершить проверку" }).click();
  await expect(page.locator(".toast").first()).toContainText("максимум — 1");
  await scoreFields.nth(0).fill("1");
  await page.getByRole("button", { name: "Завершить проверку" }).click();
  await expect(page.locator(".toast").first()).toContainText("Проверено · Оценка 4: 10 × 1 = 10 → 10 Эйнштейнов; +1 EXP");
  const submissions = await page.request.get("/api/teacher/submissions").then((response) => response.json());
  const completedSubmission = submissions.find((item: { assignment: { title: string } }) => item.assignment.title === "Фото и проверка · аудит Вайба");
  expect(completedSubmission.status).toBe("COMPLETED");
  const csrf = await page.evaluate(() => document.cookie.match(/(?:^|; )vibe_csrf=([^;]+)/u)?.[1] ?? "");
  const duplicateReview = await page.request.post(`/api/teacher/submissions/${completedSubmission.id}/review`, { headers: { "x-csrf-token": decodeURIComponent(csrf) }, data: { action: "complete", scores: {}, comment: "Повторный запрос" } });
  expect(duplicateReview.status()).toBe(404);

  await page.goto("/teacher");
  await page.getByRole("button", { name: "Создать работу" }).click();
  await page.getByLabel("Название").fill("Быстрая проверка · аудит Вайба");
  await page.getByLabel("Предмет").fill("Математика");
  await page.getByLabel("Описание и условия").fill("Автоматическая проверка короткого ответа.");
  await page.getByRole("checkbox", { name: "7A" }).check();
  await page.locator(".composer-question").nth(0).getByLabel("Условие").fill("Сколько будет 2 + 2?");
  await page.locator(".composer-question").nth(0).getByLabel("Правильный ответ(ы)").fill("4");
  await page.getByRole("button", { name: "Опубликовать работу" }).click();
  await expect(page.locator(".toast").first()).toContainText("Работа опубликована");

  await signIn("Пользователь 1");
  const profile = await page.request.get("/api/profile/customize").then((response) => response.json());
  expect(profile).toMatchObject({ totalExp: 1, level: 1 });
  const reviewedPhotoWork = await page.request.get(`/api/tasks/${completedSubmission.assignment.id}`).then((response) => response.json());
  expect(reviewedPhotoWork.submission).toMatchObject({ status: "COMPLETED", grade: 4, reward: { einsteins: 10, exp: 1 } });
  expect(await page.request.get("/api/profile").then((response) => response.json())).toMatchObject({ waitingForReview: 0, waitingForReviewDays: 0, streak: { current: 1 } });
  await page.goto("/tasks");
  await page.getByRole("link", { name: "Открыть Быстрая проверка · аудит Вайба", exact: true }).click();
  await page.getByRole("button", { name: /Начать выполнение/u }).click();
  await page.locator(".answer-input input").fill("4");
  await page.getByRole("button", { name: /Сдать работу/u }).click();
  await expect(page.locator(".toast").first()).toContainText("Оценка 5: 10 × 1 = 10 → 10 Эйнштейнов; +1 EXP");
  await expect(page.getByRole("heading", { name: "Оценка 5" })).toBeVisible();
  const afterAutomatic = await page.request.get("/api/profile/customize").then((response) => response.json());
  expect(afterAutomatic).toMatchObject({ totalExp: 2, level: 1 });
  for (const [title, answer, kind] of [["Числовой ответ · аудит Вайба", "5,1", "NUMBER"], ["Один вариант · аудит Вайба", "Зелёный", "SINGLE_CHOICE"], ["Нулевой ответ · аудит Вайба", "0", "NUMBER"], ["Альтернативный ответ · аудит Вайба", "Альтернативный", "SHORT_TEXT"]]) {
    await page.goto("/tasks");
    await page.getByRole("link", { name: `Открыть ${title}`, exact: true }).click();
    await page.getByRole("button", { name: /Начать выполнение/u }).click();
    if (kind === "SINGLE_CHOICE") await page.getByRole("radio", { name: answer }).check();
    else await page.getByRole("textbox", { name: "Твой ответ" }).fill(answer);
    await page.getByRole("button", { name: /Сдать работу/u }).click();
    await expect(page.locator(".toast").first()).toContainText("Оценка 5: 10 × 1 = 10 → 10 Эйнштейнов; +1 EXP");
  }
  const afterTypedQuestionKinds = await page.request.get("/api/profile/customize").then((response) => response.json());
  expect(afterTypedQuestionKinds).toMatchObject({ totalExp: 6, level: 2 });
  await expect(page.request.get("/api/market").then((response) => response.json())).resolves.toMatchObject({ balance: 60 });

  await signIn("Пользователь 2");
  await page.getByRole("button", { name: "Создать работу" }).click();
  await page.getByLabel("Название").fill("Итоговая оценка 3 · проверка награды");
  await page.getByLabel("Предмет").fill("Проверка награды");
  await page.getByLabel("Описание и условия").fill("Один ответ из двух соответствует оценке 3 и базовой награде 5.");
  await page.getByRole("checkbox", { name: "7A" }).check();
  await page.locator(".composer-question").nth(0).getByLabel("Условие").fill("Первый ответ");
  await page.locator(".composer-question").nth(0).getByLabel("Правильный ответ(ы)").fill("верно");
  await page.getByRole("button", { name: "Добавить вопрос" }).click();
  await page.locator(".composer-question").nth(1).getByLabel("Условие").fill("Второй ответ");
  await page.locator(".composer-question").nth(1).getByLabel("Правильный ответ(ы)").fill("правильно");
  await page.getByRole("button", { name: "Опубликовать работу" }).click();
  await expect(page.locator(".toast").first()).toContainText("Работа опубликована");
  const gradeThreeTask = (await page.request.get("/api/teacher/assignments").then((response) => response.json())).find((assignment: { title: string }) => assignment.title === "Итоговая оценка 3 · проверка награды");
  expect(gradeThreeTask).toBeTruthy();
  await signIn("Пользователь 1");
  await page.goto("/tasks");
  await page.getByRole("link", { name: "Открыть Итоговая оценка 3 · проверка награды", exact: true }).click();
  await page.getByRole("button", { name: /Начать выполнение/u }).click();
  await page.locator(".answer-input input").nth(0).fill("верно");
  await page.locator(".answer-input input").nth(1).fill("ошибка");
  await page.getByRole("button", { name: /Сдать работу/u }).click();
  await expect(page.getByRole("heading", { name: "Оценка 3" })).toBeVisible();
  await expect(page.locator(".result-card")).toContainText("Оценка 3: 5 × 1 = 5 → 5 Эйнштейнов; +1 EXP");
  const gradeThreeReward = await page.request.get(`/api/tasks/${gradeThreeTask.id}`).then((response) => response.json());
  expect(gradeThreeReward.submission).toMatchObject({ grade: 3, reward: { einsteins: 5, exp: 1 } });
  await expect(page.request.get("/api/profile/customize").then((response) => response.json())).resolves.toMatchObject({ totalExp: 7, level: 2 });
  await expect(page.request.get("/api/market").then((response) => response.json())).resolves.toMatchObject({ balance: 65 });
  await page.reload();
  await expect(page.locator(".result-card")).toContainText("Оценка 3: 5 × 1 = 5 → 5 Эйнштейнов; +1 EXP");
  const ledgerAfterReload = await page.request.get("/api/profile").then((response) => response.json());
  expect(ledgerAfterReload.ledger.filter((entry: { kind: string; note: string }) => entry.kind === "TASK_REWARD" && entry.note.includes("Оценка 3")).length).toBe(1);

  await page.goto("/market");
  await expect(page.getByRole("heading", { name: "Маркетплейс" })).toBeVisible();
  const globalSticker = page.locator(".product-card").filter({ hasText: "Набор стикеров" });
  const globalStickerId = (await page.request.get("/api/market").then((response) => response.json())).products.find((product: { name: string }) => product.name === "Набор стикеров").id;
  await globalSticker.getByRole("button", { name: "Добавить в избранное" }).click();
  await expect(page.locator(".toast").first()).toContainText("Список желаний обновлён");
  await expect(page.request.get("/api/market").then((response) => response.json())).resolves.toMatchObject({ favorites: [globalStickerId] });
  await page.getByRole("checkbox", { name: "Избранное" }).check();
  await expect(page.locator(".product-card")).toHaveCount(1);
  await page.locator(".product-card").getByRole("button", { name: "Убрать из избранного" }).click();
  await expect(page.getByRole("heading", { name: "Товаров не найдено" })).toBeVisible();
  await expect(page.request.get("/api/market").then((response) => response.json())).resolves.toMatchObject({ favorites: [] });
  await page.getByRole("checkbox", { name: "Избранное" }).uncheck();
  await page.getByRole("tab", { name: "Творчество" }).click();
  await expect(page.locator(".product-card")).toHaveCount(1);
  await page.getByRole("tab", { name: "Все категории" }).click();
  await expect(page.locator(".product-card")).toHaveCount(2);
  await globalSticker.getByRole("button", { name: "Копить на это" }).click();
  await expect(page.locator(".toast").first()).toContainText("Цель накопления сохранена");
  await expect(page.request.get("/api/market").then((response) => response.json())).resolves.toMatchObject({ savingsGoal: { product: { name: "Набор стикеров" } } });
  await globalSticker.getByRole("button", { name: "Убрать цель" }).click();
  await expect(page.request.get("/api/market").then((response) => response.json())).resolves.toMatchObject({ savingsGoal: null });
  await page.locator(".product-card").filter({ hasText: "Набор стикеров" }).getByRole("button", { name: "Выбрать" }).click();
  await page.getByRole("button", { name: "Подтвердить покупку" }).click();
  await expect(page.locator(".toast").first()).toContainText("Заказ создан");
  let market = await page.request.get("/api/market").then((response) => response.json());
  expect(market.balance).toBe(60);
  await page.getByRole("button", { name: "Отменить" }).click();
  await expect(page.locator(".toast").first()).toContainText("Эйнштейны возвращены");
  market = await page.request.get("/api/market").then((response) => response.json());
  expect(market.balance).toBe(65);
  expect(market.orders[0].status).toBe("CANCELLED");

  const marketSearch = page.getByRole("textbox", { name: "Поиск товаров" });
  await marketSearch.fill("стикер");
  await expect(page.locator(".product-card")).toHaveCount(1);
  await marketSearch.fill("точно нет такого товара");
  await expect(page.getByRole("heading", { name: "Товаров не найдено" })).toBeVisible();
  await page.getByRole("button", { name: "Очистить поиск товаров" }).click();
  await expect(marketSearch).toHaveValue("");
  const marketFocusStyles = await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('.market-page input[aria-label="Поиск товаров"]')!;
    return { focused: document.activeElement === input, fieldOutline: getComputedStyle(input).outlineWidth, wrapperOutline: getComputedStyle(input.parentElement!).outlineWidth, inputSize: getComputedStyle(input).fontSize };
  });
  expect(marketFocusStyles).toMatchObject({ focused: true, fieldOutline: "0px", wrapperOutline: "3px", inputSize: "16px" });
  await page.screenshot({ path: resolve(process.cwd(), "test-results/vibe-search-390.png"), fullPage: true });

  await page.getByRole("tab", { name: "Школьный маркет" }).click();
  await expect(page.locator(".product-card")).toHaveCount(2);
  await page.getByRole("tab", { name: "Школьная жизнь" }).click();
  await expect(page.locator(".product-card")).toHaveCount(1);
  await page.getByRole("tab", { name: "Все категории" }).click();
  await expect(page.locator(".product-card")).toHaveCount(2);
  await page.locator(".product-card").filter({ hasText: "Выбор активности" }).getByRole("button", { name: "Выбрать" }).click();
  await page.getByRole("button", { name: "Подтвердить покупку" }).click();
  await expect(page.locator(".toast").first()).toContainText("Заказ создан");
  market = await page.request.get("/api/market").then((response) => response.json());
  expect(market.balance).toBe(60);
  const schoolOrderId = market.orders.find((order: { name: string }) => order.name === "Выбор активности").id;
  expect(market.orders.find((order: { name: string }) => order.name === "Выбор активности").status).toBe("RESERVED");

  await signIn("Пользователь 3");
  await page.goto("/admin");
  const pendingSchoolOrder = page.locator(".admin-orders-card .order-row").filter({ hasText: "Выбор активности" });
  await expect(pendingSchoolOrder.getByRole("button", { name: "Подтвердить выдачу" })).toBeVisible();
  await pendingSchoolOrder.getByRole("button", { name: "Подтвердить выдачу" }).click();
  await expect(page.locator(".toast").first()).toContainText("Изменение сохранено");
  expect(await page.request.get("/api/admin/orders").then((response) => response.json())).toEqual(expect.arrayContaining([expect.objectContaining({ id: schoolOrderId, status: "FULFILLED", name: "Выбор активности" })]));
  await page.getByLabel("Название нового класса").fill("8Б");
  await page.getByRole("button", { name: "Создать класс" }).click();
  await expect(page.locator(".toast").first()).toContainText("Изменение сохранено");
  const teacherRow = page.locator("tbody tr").filter({ hasText: "Пользователь 2" });
  await teacherRow.getByRole("button", { name: /Настроить \(1\)/u }).click();
  const teacherClassDialog = page.getByRole("dialog", { name: "Классы учителя · Пользователь 2" });
  await expect(teacherClassDialog.getByLabel("7A")).toBeChecked();
  await teacherClassDialog.getByLabel("8Б").check();
  await teacherClassDialog.getByRole("button", { name: "Сохранить классы" }).click();
  await expect(page.locator(".toast").first()).toContainText("Назначения учителя сохранены");
  expect(await page.request.get("/api/admin/classes").then((response) => response.json())).toEqual(expect.arrayContaining([expect.objectContaining({ name: "8Б" })]));
  await expect(teacherRow.getByRole("button", { name: /Настроить \(2\)/u })).toBeVisible();
  const class8b = page.locator(".admin-class-item").filter({ hasText: "8Б" });
  await expect(class8b).toContainText("1 учителей");

  await page.getByLabel("Название нового класса").fill("Переименуемый QA");
  await page.getByRole("button", { name: "Создать класс" }).click();
  const editableClass = page.locator(".admin-class-item").filter({ hasText: "Переименуемый QA" });
  await editableClass.getByRole("button", { name: "Редактировать" }).click();
  await editableClass.getByLabel("Новое название класса").fill("Удаляемый QA");
  await editableClass.getByRole("button", { name: "Сохранить название" }).click();
  await expect(page.locator(".admin-class-item").filter({ hasText: "Удаляемый QA" })).toBeVisible();
  const deletableClass = page.locator(".admin-class-item").filter({ hasText: "Удаляемый QA" });
  await deletableClass.getByRole("button", { name: "Удалить" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Подтвердить удаление" }).click();
  await expect(page.locator(".admin-class-item").filter({ hasText: "Удаляемый QA" })).toHaveCount(0);
  expect((await page.request.get("/api/admin/classes").then((response) => response.json())).some((row: { name: string }) => row.name === "Удаляемый QA")).toBeFalsy();

  await page.getByLabel("Название нового класса").fill("Архивируемый QA");
  await page.getByRole("button", { name: "Создать класс" }).click();
  const archivableClass = page.locator(".admin-class-item").filter({ hasText: "Архивируемый QA" });
  await archivableClass.getByRole("button", { name: "В архив" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Подтвердить архив" }).click();
  await page.getByLabel("Показать").selectOption("archived");
  const archivedClass = page.locator(".admin-class-item").filter({ hasText: "Архивируемый QA" });
  await expect(archivedClass).toContainText("Архив");
  await archivedClass.getByRole("button", { name: "Восстановить" }).click();
  await expect(archivedClass).toHaveCount(0);
  await page.getByLabel("Показать").selectOption("active");
  const restoredClass = page.locator(".admin-class-item").filter({ hasText: "Архивируемый QA" });
  await expect(restoredClass).toBeVisible();
  await restoredClass.getByRole("button", { name: "Удалить" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Подтвердить удаление" }).click();
  await expect(page.locator(".admin-class-item").filter({ hasText: "Архивируемый QA" })).toHaveCount(0);

  await signIn("Пользователь 1");
  const fulfilledMarket = await page.request.get("/api/market").then((response) => response.json());
  expect(fulfilledMarket).toMatchObject({ balance: 60 });
  expect(fulfilledMarket.orders.find((order: { id: string }) => order.id === schoolOrderId).status).toBe("FULFILLED");

  await signIn("Пользователь 2");
  await page.goto("/teacher");
  expect(await page.request.get("/api/teacher/classes").then((response) => response.json().then((rows) => rows.map((row: { name: string }) => row.name).sort()))).toEqual(["7A", "8Б"].sort());
  await page.getByRole("button", { name: "Создать работу" }).click();
  await page.getByLabel("Название").fill("Два класса · аудит Вайба");
  await page.getByLabel("Предмет").fill("Общий проект");
  await page.getByLabel("Описание и условия").fill("Работа назначена сразу двум классам.");
  await page.getByRole("checkbox", { name: "7A" }).check();
  await page.getByRole("checkbox", { name: "8Б" }).check();
  await page.locator(".composer-question").first().getByLabel("Условие").fill("Напиши слово команда.");
  await page.locator(".composer-question").first().getByLabel("Правильный ответ(ы)").fill("команда");
  await page.getByRole("button", { name: "Опубликовать работу" }).click();
  await expect(page.locator(".toast").first()).toContainText("Работа опубликована");
  const multiClassTask = (await page.request.get("/api/teacher/assignments").then((response) => response.json())).find((assignment: { title: string }) => assignment.title === "Два класса · аудит Вайба");
  expect(multiClassTask.classes.sort()).toEqual(["7A", "8Б"].sort());
  expect(multiClassTask.recipients).toBe(1);
  for (let index = 1; index <= 1; index += 1) {
    const title = `Путь к уровню ${index} · аудит Вайба`;
    await page.getByRole("button", { name: "Создать работу" }).click();
    await page.getByLabel("Название").fill(title);
    await page.getByLabel("Предмет").fill("Практика");
    await page.getByLabel("Описание и условия").fill("Короткая работа для проверки сохранения опыта и открытия оформления.");
    await page.getByRole("checkbox", { name: "7A" }).check();
    await page.locator(".composer-question").nth(0).getByLabel("Условие").fill(`Напиши слово готово (${index}).`);
    await page.locator(".composer-question").nth(0).getByLabel("Правильный ответ(ы)").fill("готово");
    await page.getByRole("button", { name: "Опубликовать работу" }).click();
    await expect(page.locator(".toast").first()).toContainText("Работа опубликована");
  }

  await signIn("Пользователь 1");
  const tasksAfterMulticlassPublish = await page.request.get("/api/tasks").then((response) => response.json());
  expect(tasksAfterMulticlassPublish.tasks.map((task: { title: string }) => task.title)).toContain("Два класса · аудит Вайба");
  for (let index = 1; index <= 1; index += 1) {
    const title = `Путь к уровню ${index} · аудит Вайба`;
    await page.goto("/tasks");
    await page.getByRole("link", { name: `Открыть ${title}`, exact: true }).click();
    await page.getByRole("button", { name: /Начать выполнение/u }).click();
    await page.locator(".answer-input input").fill("готово");
    await page.getByRole("button", { name: /Сдать работу/u }).click();
    await expect(page.locator(".toast").first()).toContainText("Оценка 5: 10 × 1 = 10 → 10 Эйнштейнов; +1 EXP");
  }
  const eightTaskProfile = await page.request.get("/api/profile/customize").then((response) => response.json());
  expect(eightTaskProfile).toMatchObject({ totalExp: 8, level: 3 });
  await expect(page.request.get("/api/market").then((response) => response.json())).resolves.toMatchObject({ balance: 70 });
  await page.goto("/profile/customize");
  const firstUnlockedEmoji = page.getByRole("button", { name: "Искра 1, открыто" });
  await expect(firstUnlockedEmoji).toBeVisible();
  const noEmoji = page.getByRole("button", { name: "Без эмодзи, открыто" });
  const noFrame = page.locator(".frame-cosmetic-card").filter({ hasText: "Без рамки" });
  const noTitle = page.getByRole("button", { name: "Без подписи, открыто" });
  const noPattern = page.getByRole("button", { name: "Без узора, открыто" });
  for (const card of [noEmoji, noFrame, noTitle, noPattern]) await expect(card).toBeVisible();
  await firstUnlockedEmoji.click();
  const saveAppearance = page.locator(".customize-actions").getByRole("button", { name: "Сохранить изменения" });
  await expect(saveAppearance).toBeEnabled();
  await expect(firstUnlockedEmoji.locator(".cosmetic-meta small")).toHaveText("Выбрано");
  await expect(noEmoji.locator(".cosmetic-meta small")).toHaveText("Открыто");
  await saveAppearance.click();
  await expect(page.locator(".toast").first()).toContainText("Оформление сохранено");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Оформление" })).toBeVisible();
  let savedAppearance = await page.request.get("/api/profile/customize").then((response) => response.json());
  expect(savedAppearance).toMatchObject({ totalExp: 8, level: 3, appearance: { emoji: "spark-1" } });
  const savedNoEmoji = page.getByRole("button", { name: "Без эмодзи, открыто" });
  await savedNoEmoji.click();
  await expect(savedNoEmoji.locator(".cosmetic-meta small")).toHaveText("Выбрано");
  await expect(saveAppearance).toBeEnabled();
  await saveAppearance.click();
  await expect(page.locator(".toast").first()).toContainText("Оформление сохранено");
  await page.reload();
  savedAppearance = await page.request.get("/api/profile/customize").then((response) => response.json());
  expect(savedAppearance.appearance.emoji).toBe("emoji-none");
  await page.getByRole("button", { name: "Искра 1, открыто" }).click();
  await expect(saveAppearance).toBeEnabled();
  await saveAppearance.click();
  await expect(page.locator(".toast").first()).toContainText("Оформление сохранено");
  await page.reload();
  savedAppearance = await page.request.get("/api/profile/customize").then((response) => response.json());
  expect(savedAppearance).toMatchObject({ totalExp: 8, level: 3, appearance: { emoji: "spark-1" } });

  for (const { width, height, wheel } of [{ width: 320, height: 404, wheel: 80 }, { width: 390, height: 844, wheel: 240 }]) {
    await page.setViewportSize({ width, height });
    await page.goto("/profile/customize");
    const lastCosmetic = page.getByRole("button", { name: "Путешественник, откроется с уровня 10" });
    await expect(lastCosmetic).toBeVisible();
    await lastCosmetic.scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, wheel);
    // A wheel event is asynchronous; measure only after scrolling settles.
    await expect.poll(() => page.evaluate(() => {
      const card = document.querySelector(".cosmetic-grid .cosmetic-card:last-child")!.getBoundingClientRect();
      const actions = document.querySelector(".customize-actions")!.getBoundingClientRect();
      return card.bottom - actions.top;
    }), { timeout: 5000 }).toBeLessThanOrEqual(0);
    const cosmeticLayout = await page.evaluate(() => {
      const last = document.querySelector(".cosmetic-grid .cosmetic-card:last-child")!.getBoundingClientRect();
      const actions = document.querySelector(".customize-actions")!.getBoundingClientRect();
      const navigation = document.querySelector(".bottom-nav")!.getBoundingClientRect();
      const topbar = document.querySelector(".topbar")!.getBoundingClientRect();
      return { lastTop: last.top, lastBottom: last.bottom, topbarBottom: topbar.bottom, actionsTop: actions.top, actionsBottom: actions.bottom, navigationTop: navigation.top };
    });
                                                                           
                                         
    expect(cosmeticLayout.lastTop + 1, "Последняя карточка должна оставаться на экране").toBeGreaterThanOrEqual(cosmeticLayout.topbarBottom);
    expect(cosmeticLayout.lastBottom, `Последняя карточка не должна перекрываться панелью при ширине ${width}px`).toBeLessThanOrEqual(cosmeticLayout.actionsTop);
    expect(cosmeticLayout.actionsBottom, `Панель оформления должна оставаться выше нижней навигации при ширине ${width}px`).toBeLessThanOrEqual(cosmeticLayout.navigationTop);
    await page.screenshot({ path: resolve(process.cwd(), `test-results/vibe-customize-traveler-${width}.png`) });
  }

                                                                             
                                                                             
  await page.setViewportSize({ width: 765, height: 668 });
  await page.goto("/profile/customize");
  await page.locator(".cosmetic-grid .cosmetic-card").last().scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo({ top: 900, behavior: "instant" }));
  const wideCustomizeLayout = await page.evaluate(() => {
    const actions = document.querySelector(".customize-actions")!.getBoundingClientRect();
    const navigation = document.querySelector(".bottom-nav")!;
    return { actionsBottom: actions.bottom, viewportHeight: innerHeight, navigationDisplay: getComputedStyle(navigation).display };
  });
  expect(wideCustomizeLayout.navigationDisplay).toBe("none");
  expect(wideCustomizeLayout.viewportHeight - wideCustomizeLayout.actionsBottom).toBeLessThanOrEqual(1);
  await page.screenshot({ path: resolve(process.cwd(), "test-results/vibe-customize-actions-765.png") });

  await page.goto("/profile");
  for (const { width, height, screenshot } of [
    { width: 320, height: 800, screenshot: "test-results/vibe-profile-coin-320.png" },
    { width: 390, height: 844, screenshot: "test-results/vibe-profile-coin-390.png" },
    { width: 1440, height: 900, screenshot: "test-results/vibe-profile-coin-1440.png" },
  ]) {
    await page.setViewportSize({ width, height });
    const coin = await page.locator(".profile-hero-card .einstein-coin").evaluate((element) => {
      const box = element.getBoundingClientRect();
      const badge = element.closest(".balance-badge")!.getBoundingClientRect();
      const image = element.querySelector("img") as HTMLImageElement;
      return { width: box.width, height: box.height, centerDelta: Math.abs((box.top + box.bottom) / 2 - (badge.top + badge.bottom) / 2), loaded: image.complete && image.naturalWidth >= 640 };
    });
    expect(coin.loaded).toBe(true);
    expect(coin.width).toBeCloseTo(48, 1);
    expect(coin.height).toBeCloseTo(48, 1);
    expect(coin.centerDelta).toBeLessThan(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: screenshot, fullPage: true });
  }

  await page.goto("/tasks");
  for (const { width, height } of [{ width: 320, height: 800 }, { width: 360, height: 800 }, { width: 390, height: 844 }, { width: 456, height: 844 }, { width: 520, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const taskSearch = page.getByRole("textbox", { name: "Поиск по заданиям" });
  await taskSearch.fill("совсем другая работа");
  await page.getByRole("button", { name: "Очистить поиск по заданиям" }).click();
  await expect(taskSearch).toHaveValue("");
  const focusStyles = await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>(".search-box input")!;
    return { focused: document.activeElement === input, fieldOutline: getComputedStyle(input).outlineWidth, wrapperOutline: getComputedStyle(input.parentElement!).outlineWidth, inputSize: getComputedStyle(input).fontSize };
  });
  expect(focusStyles).toMatchObject({ focused: true, fieldOutline: "0px", wrapperOutline: "3px", inputSize: "16px" });
  expect(await page.evaluate(() => getComputedStyle(document.querySelector(".bottom-nav .nav-link")!).fontSize)).toBe("16px");
  await page.screenshot({ path: "test-results/vibe-presentation-390.png", fullPage: true });
  await page.setViewportSize({ width: 720, height: 960 });
  await page.evaluate(() => { document.body.style.zoom = "2"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(720);
  await page.evaluate(() => { document.body.style.zoom = "1"; });
  await page.goto("/admin");
  await expect(page.getByText("Панель школы недоступна")).toBeVisible();
  await expect(page.request.get("/api/teacher/assignments").then((response) => response.status())).resolves.toBe(403);

  await signIn("Пользователь 3");
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Панель школы" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Кабинет учителя" })).toHaveCount(0);
  const schoolUsers = await page.request.get("/api/admin/users").then((response) => response.json());
  expect(schoolUsers.map((user: { name: string }) => user.name).sort()).toEqual(["Пользователь 1", "Пользователь 2", "Пользователь 3"]);
  expect(schoolUsers.map((user: { role: string }) => user.role).sort()).toEqual(["SCHOOL_ADMIN", "STUDENT", "TEACHER"]);
  const schoolProductName = `Награда школы QA ${Date.now()}`;
  const schoolProductForm = page.locator(".owner-product-manager form.owner-product-form");
  await schoolProductForm.getByLabel("Название товара").fill(schoolProductName);
  await schoolProductForm.getByLabel("Описание и условие выдачи").fill("Проверка карточки, фото и управления школьной наградой.");
  await schoolProductForm.getByLabel("Добавить фото школьного товара").setInputFiles(classroomImage);
  await schoolProductForm.getByRole("button", { name: "Добавить награду" }).click();
  const schoolProductRow = page.locator(".admin-page .owner-product-row").filter({ hasText: schoolProductName });
  await expect(schoolProductRow).toBeVisible();
  const schoolProductImage = schoolProductRow.locator("img");
  await expect(schoolProductImage).toBeVisible();
  const schoolProductImageUrl = await schoolProductImage.getAttribute("src");
  expect(await page.request.get(schoolProductImageUrl!).then((response) => response.status())).toBe(200);
  await page.reload();
  const persistedSchoolProduct = page.locator(".admin-page .owner-product-row").filter({ hasText: schoolProductName });
  await expect(persistedSchoolProduct.locator("img")).toBeVisible();
  await persistedSchoolProduct.getByRole("button", { name: "Изменить" }).click();
  const schoolProductEdit = persistedSchoolProduct.locator("form.owner-product-edit");
  await schoolProductEdit.getByLabel("Цена в Эйнштейнах").fill("8");
  await schoolProductEdit.getByRole("button", { name: "Сохранить" }).click();
  await expect(persistedSchoolProduct).toContainText("8 Э");
  expect(pageErrors).toEqual([]);
  await page.screenshot({ path: "test-results/vibe-admin-390.png", fullPage: true });
});

test("v7 project-owner school lifecycle, explicit fourth role, catalog management, and isolation", async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const signInAs = async (profileName: string) => {
    const authenticated = await page.getByRole("button", { name: "Открыть главное меню" }).count() > 0;
    if (authenticated) {
      await page.getByRole("button", { name: "Открыть главное меню" }).click();
      await page.getByRole("button", { name: "Завершить сеанс" }).click();
      await expect(page.getByRole("button", { name: "Тест" })).toBeVisible();
    } else await page.goto("/");
    await page.getByRole("button", { name: "Тест" }).click();
    await page.getByRole("button", { name: new RegExp(profileName, "u") }).click();
    const path = profileName === "Пользователь 4" ? "/owner/schools" : profileName === "Пользователь 3" ? "/admin" : "/tasks";
    await page.waitForURL(new RegExp(`${path}$`, "u"));
  };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Тест" }).click();
  const profileDialog = page.getByRole("dialog");
  await expect(profileDialog.locator(".test-profile-card")).toHaveCount(4);
  await expect(profileDialog.getByRole("button", { name: /Пользователь 4/u })).toContainText("Владелец проекта");
  await profileDialog.getByRole("button", { name: /Пользователь 4/u }).click();
  await page.waitForURL(/\/owner\/schools$/u);
  const ownerSession = await page.request.get("/api/session/me").then((response) => response.json());
  expect(ownerSession.user).toMatchObject({ name: "Пользователь 4", role: "PROJECT_OWNER", school: null, class: null });
  expect(await page.request.get("/api/owner/schools").then((response) => response.json())).toHaveLength(1);

  await page.goto("/owner");
  await expect(page.getByRole("heading", { name: "Владелец Вайба" })).toBeVisible();
  for (const width of [320, 360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width < 500 ? 800 : 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `owner has no horizontal overflow at ${width}px`).toBeLessThanOrEqual(width);
    const tileText = await page.locator(".admin-kpi-grid .stat-tile").evaluateAll((tiles) => tiles.flatMap((tile) => {
      const tileRect = tile.getBoundingClientRect();
      return Array.from(tile.querySelectorAll<HTMLElement>(".overline, strong, small")).map((element) => {
        const rect = element.getBoundingClientRect();
        return { text: element.innerText, fits: rect.left >= tileRect.left - 1 && rect.right <= tileRect.right + 1 && rect.bottom <= tileRect.bottom + 1 };
      });
    }));
    expect(tileText.filter((item) => !item.fits), `owner KPI text fits every stat tile at ${width}px`).toEqual([]);
    if (width === 390) await page.screenshot({ path: "test-results/vibe-owner-390.png", fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Владелец Вайба" })).toBeVisible();
  await page.getByRole("link", { name: "Управлять списком школ" }).click();
  await expect(page.getByRole("heading", { name: "Школы", exact: true })).toBeVisible();

  const createdNames = new Set<string>();
  const createSchool = async (name: string, city: string) => {
    createdNames.add(name);
    await page.getByRole("button", { name: "Создать школу" }).click();
    const form = page.locator("form.owner-create-form").last();
    await form.getByLabel("Название школы").fill(name);
    await form.getByLabel("Город").fill(city);
    await form.getByLabel("Часовой пояс").fill("Europe/Moscow");
    const requestPromise = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === "/api/owner/schools" && request.postDataJSON()?.name === name);
    await form.getByRole("button", { name: "Создать" }).click();
    const request = await requestPromise;
    await expect(page.locator(".owner-school-item").filter({ hasText: name })).toBeVisible();
    return { name, body: request.postDataJSON() };
  };
  const first = await createSchool("Аудит Вайба QA", "Казань");
  const firstRow = page.locator(".owner-school-item").filter({ hasText: first.name });
  const firstReplay = await page.evaluate(async (body) => {
    const csrf = decodeURIComponent(document.cookie.match(/(?:^|; )vibe_csrf=([^;]+)/u)?.[1] ?? "");
    const response = await fetch("/api/owner/schools", { method: "POST", credentials: "include", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify(body) });
    return { status: response.status, value: await response.json() };
  }, first.body);
  expect(firstReplay.status).toBe(200);
  expect(firstReplay.value.id).toBe((await page.request.get("/api/owner/schools").then((response) => response.json())).find((item: { name: string }) => item.name === first.name).id);
  expect(await page.request.get("/api/owner/schools").then((response) => response.json().then((items) => items.filter((item: { name: string }) => item.name === first.name).length))).toBe(1);

  await firstRow.getByRole("button", { name: "Редактировать" }).click();
  const editForm = firstRow.locator("form.owner-create-form");
  await editForm.getByLabel("Название школы").fill("Аудит Вайба QA · изменено");
  await editForm.getByLabel("Город").fill("Тверь");
  await editForm.getByLabel("Часовой пояс").fill("Europe/Moscow");
  await editForm.getByRole("button", { name: "Сохранить изменения" }).click();
  await expect(page.locator(".owner-school-item").filter({ hasText: "Аудит Вайба QA · изменено" })).toContainText("Тверь");
  const editedName = "Аудит Вайба QA · изменено";
  await page.reload();
  await expect(page.locator(".owner-school-item").filter({ hasText: editedName })).toBeVisible();
  const stableSchoolId = (await page.request.get("/api/owner/schools").then((response) => response.json())).find((item: { name: string }) => item.name === editedName).id;

  const empty = await createSchool("Пустая школа для удаления QA", "Киров");
  const emptyRow = page.locator(".owner-school-item").filter({ hasText: empty.name });
  await emptyRow.getByRole("button", { name: "Удалить" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Подтвердить удаление" }).click();
  await expect(page.locator(".owner-school-item").filter({ hasText: empty.name })).toHaveCount(0);
  expect(await page.request.get(`/api/owner/schools?status=active`).then((response) => response.json().then((rows) => rows.some((row: { name: string }) => row.name === empty.name)))).toBeFalsy();

  const archiveButton = page.locator(".owner-school-item").filter({ hasText: editedName }).getByRole("button", { name: "В архив" });
  await archiveButton.click();
  await page.getByRole("dialog").getByRole("button", { name: "Подтвердить архив" }).click();
  await expect(page.locator(".owner-school-item").filter({ hasText: editedName })).toHaveCount(0);
  await page.getByLabel("Статус").selectOption("archived");
  const archivedRow = page.locator(".owner-school-item").filter({ hasText: editedName });
  await expect(archivedRow).toBeVisible();
  await archivedRow.getByRole("button", { name: "Восстановить" }).click();
  await expect(archivedRow).toHaveCount(0);
  await page.getByLabel("Статус").selectOption("active");
  const restoredFirstRow = page.locator(".owner-school-item").filter({ hasText: editedName });
  await expect(restoredFirstRow).toBeVisible();
  expect(await page.request.get("/api/owner/schools").then((response) => response.json().then((rows) => rows.find((row: { id: string }) => row.id === stableSchoolId)?.archivedAt ?? null))).toBeNull();
  await restoredFirstRow.getByRole("button", { name: "В архив" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Подтвердить архив" }).click();
  await page.getByLabel("Статус").selectOption("archived");
  const finalArchivedFirstRow = page.locator(".owner-school-item").filter({ hasText: editedName });
  await expect(finalArchivedFirstRow).toBeVisible();
  expect((await page.request.get("/api/owner/schools?status=archived").then((response) => response.json())).find((row: { id: string }) => row.id === stableSchoolId)?.archivedAt).toBeTruthy();
  await page.getByLabel("Статус").selectOption("active");

  const staffSchool = await createSchool("Школа назначения QA", "Пермь");
  const staffRow = page.locator(".owner-school-item").filter({ hasText: staffSchool.name });
  await staffRow.getByRole("button", { name: "Открыть" }).click();
  const adminSelect = staffRow.getByLabel(`Администратор для ${staffSchool.name}`);
  await adminSelect.selectOption({ label: "Проверочный аккаунт школы · без школы" });
  await staffRow.getByRole("button", { name: "Назначить" }).click();
  await expect(staffRow).toContainText("1 администраторов");
  await expect(staffRow).toContainText("Проверочный аккаунт школы");
  await page.reload();
  const persistedStaffRow = page.locator(".owner-school-item").filter({ hasText: staffSchool.name });
  await persistedStaffRow.getByRole("button", { name: "Открыть" }).click();
  await expect(persistedStaffRow).toContainText("Проверочный аккаунт школы");
  await persistedStaffRow.getByRole("button", { name: "Снять полномочия" }).click();
  await expect(persistedStaffRow.locator(".school-admins")).toContainText("Администраторы не назначены");
  expect(await page.request.get(`/api/owner/users?schoolId=${encodeURIComponent((await page.request.get("/api/owner/schools").then((response) => response.json())).find((item: { name: string }) => item.name === staffSchool.name).id)}`).then((response) => response.json().then((rows) => rows.items.find((row: { name: string }) => row.name === "Проверочный аккаунт школы")?.roles)).then((roles) => roles)).toContain("STUDENT");
  await expect(persistedStaffRow.getByRole("button", { name: "Снять полномочия" })).toHaveCount(0);
  const staffSchoolId = (await page.request.get("/api/owner/schools").then((response) => response.json())).find((item: { name: string }) => item.name === staffSchool.name).id;
  await persistedStaffRow.getByRole("button", { name: "В архив" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Подтвердить архив" }).click();
  await page.getByLabel("Статус").selectOption("archived");
  const archivedStaffRow = page.locator(".owner-school-item").filter({ hasText: staffSchool.name });
  await expect(archivedStaffRow).toBeVisible();
  expect((await page.request.get("/api/owner/schools?status=archived").then((response) => response.json())).find((item: { id: string }) => item.id === staffSchoolId)?.administrators).toEqual([]);
  await archivedStaffRow.getByRole("button", { name: "Восстановить" }).click();
  await page.getByLabel("Статус").selectOption("active");
  const restoredStaffRow = page.locator(".owner-school-item").filter({ hasText: staffSchool.name });
  await restoredStaffRow.getByRole("button", { name: "Открыть" }).click();
  await expect(restoredStaffRow).toContainText("Администраторы не назначены");
  await restoredStaffRow.getByRole("button", { name: "В архив" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Подтвердить архив" }).click();

  await page.goto("/owner");
  await page.setViewportSize({ width: 390, height: 844 });
  const productName = `Длинное название награды для проверки переноса текста в мобильном каталоге ${Date.now()}`;
  const productForm = page.locator("form.owner-product-form");
  await productForm.getByLabel("Название").fill(productName);
  await productForm.getByLabel("Описание").fill("Временная награда для проверки полного цикла управления каталогом.");
  await productForm.getByLabel("Категория").fill("Проверка");
  await productForm.getByLabel("Иконка товара").selectOption("gift");
  await productForm.getByLabel("Цена в Эйнштейнах").fill("17");
  await productForm.getByLabel("Остаток").fill("4");
  await productForm.getByLabel("Лимит на ученика").fill("1");
  await productForm.getByLabel("Добавить фото глобального товара").setInputFiles(resolve(process.cwd(), "apps/web/public/brand/vibe-logo.png"));
  await productForm.getByRole("button", { name: "Добавить награду" }).click();
  const productRow = page.locator(".owner-product-row").filter({ hasText: productName });
  await expect(productRow).toBeVisible();
  await expect(productRow.locator("img")).toBeVisible();
  const productTitleLayout = await productRow.locator(".owner-product-heading strong").evaluate((element) => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return { whiteSpace: style.whiteSpace, textOverflow: style.textOverflow, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, height: box.height };
  });
  expect(productTitleLayout.whiteSpace).toBe("normal");
  expect(productTitleLayout.textOverflow).not.toBe("ellipsis");
  expect(productTitleLayout.scrollWidth).toBeLessThanOrEqual(productTitleLayout.clientWidth + 1);
  expect(productTitleLayout.height).toBeGreaterThan(20);
  await page.reload();
  const durableProductRow = page.locator(".owner-product-row").filter({ hasText: productName });
  await expect(durableProductRow).toBeVisible();
  await durableProductRow.getByRole("button", { name: "Редактировать" }).click();
  const editProduct = durableProductRow.locator("form.owner-product-edit");
  await editProduct.getByLabel("Цена в Эйнштейнах").fill("19");
  await editProduct.getByRole("button", { name: "Сохранить" }).click();
  await expect(durableProductRow).toContainText("19 Э");

  await signInAs("Пользователь 1");
  await page.goto("/market");
  const visibleGlobalProduct = page.locator(".product-card").filter({ hasText: productName });
  await expect(visibleGlobalProduct.locator("img")).toBeVisible();
  const visibleGlobalImageUrl = await visibleGlobalProduct.locator("img").getAttribute("src");
  expect(await page.request.get(visibleGlobalImageUrl!).then((response) => response.status())).toBe(200);

  await signInAs("Пользователь 4");
  await page.goto("/owner");
  const productRowAfterReturn = page.locator(".owner-product-row").filter({ hasText: productName });
  await productRowAfterReturn.getByRole("button", { name: "Скрыть" }).click();
  const ownerProducts = await page.request.get("/api/owner/products").then((response) => response.json());
  const hiddenProduct = ownerProducts.find((product: { name: string }) => product.name === productName);
  expect(hiddenProduct?.active).toBe(false);

  await signInAs("Пользователь 1");
  await page.goto("/market");
  await expect(page.getByText(productName)).toHaveCount(0);
  expect(await page.request.get(`/api/market/products/${hiddenProduct.id}/image`).then((response) => response.status())).toBe(403);
  expect(await page.request.get("/api/admin/classes").then((response) => response.status())).toBe(403);

  await page.setViewportSize({ width: 390, height: 844 });
  await signInAs("Пользователь 3");
  expect(await page.request.get("/api/owner/schools").then((response) => response.status())).toBe(403);
  expect(await page.request.get("/api/owner/products").then((response) => response.status())).toBe(403);

  await signInAs("Пользователь 4");
  expect(await page.request.get("/api/session/me").then((response) => response.json().then((body) => body.user?.role))).toBe("PROJECT_OWNER");
  expect(await page.request.get("/api/owner/schools").then((response) => response.json().then((rows) => rows.some((row: { name: string }) => row.name === staffSchool.name)))).toBeFalsy();
  expect((await page.request.get("/api/owner/schools?status=archived").then((response) => response.json())).some((row: { name: string; archivedAt: string | null }) => row.name === staffSchool.name && row.archivedAt !== null)).toBeTruthy();
  expect(createdNames.size).toBe(3);
  expect(errors).toEqual([]);
});

test("v8 theme modes, About editor permissions and image persistence, avatar frame unlocks", async ({ page }) => {
  test.setTimeout(180_000);
  const signInAs = async (profileName: string) => {
    if (await page.locator(".app-frame").count()) {
      await page.getByRole("button", { name: "Открыть главное меню" }).click();
      await page.getByRole("button", { name: "Завершить сеанс" }).click();
      await expect(page.getByRole("button", { name: "Тест" })).toBeVisible();
    } else await page.goto("/");
    await page.getByRole("button", { name: "Тест" }).click();
    await page.getByRole("button", { name: new RegExp(profileName, "u") }).click();
    const landing = profileName === "Пользователь 4" ? "/owner/schools" : profileName === "Пользователь 3" ? "/admin" : profileName === "Пользователь 2" ? "/teacher" : "/tasks";
    await page.waitForURL(new RegExp(`${landing}$`, "u"));
  };
  const csrfHeader = async () => ({ "x-csrf-token": await page.evaluate(() => decodeURIComponent(document.cookie.match(/(?:^|; )vibe_csrf=([^;]+)/u)?.[1] ?? "")) });
  const photo = resolve(process.cwd(), "apps/web/public/brand/vibe-logo.png");
  let frameFixture: { userId: string; membershipId: string; totalExp: number; frame: string } | null = null;

  await signInAs("Пользователь 4");
  await page.setViewportSize({ width: 320, height: 404 });
  await page.getByRole("button", { name: "Открыть главное меню" }).click();
  const shortViewportDrawer = page.locator(".glass-drawer");
  expect(await shortViewportDrawer.evaluate((element) => element.scrollHeight > element.clientHeight)).toBeTruthy();
  expect(await shortViewportDrawer.evaluate((element) => getComputedStyle(element).overflowY)).toBe("auto");
  await page.getByRole("button", { name: "Завершить сеанс" }).click();
  await expect(page.getByRole("button", { name: "Тест" })).toBeVisible();
  await page.getByRole("button", { name: "Тест" }).click();
  await page.getByRole("button", { name: /Пользователь 4/u }).click();
  await page.waitForURL(/\/owner\/schools$/u);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/about");
  await expect(page.getByRole("button", { name: "Редактировать страницу" })).toBeVisible();
  await expect(page.locator(".about-page h1", { hasText: "О Вайбе" })).toBeVisible();

  const openSettings = async () => {
    if (!(await page.locator(".drawer-backdrop.is-open").count())) {
      await page.getByRole("button", { name: "Открыть главное меню" }).click();
    }
    await page.getByRole("button", { name: "Настройки" }).click();
  };
  await openSettings();
  await page.getByRole("button", { name: "Тёмная" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme-mode", "dark");
  await page.getByRole("button", { name: "Закрыть окно" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.goto("/profile");
  for (const { width, height } of [{ width: 320, height: 800 }, { width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize({ width, height });
    const name = page.locator(".profile-preview:not(.preview-compact) .preview-name h2");
    await expect(name).toHaveText("Пользователь 4");
    const nameLayout = await name.evaluate((element) => {
      const range = document.createRange();
      range.setStart(element.firstChild!, 0);
      range.setEnd(element.firstChild!, "Пользователь".length);
      const nameRect = element.getBoundingClientRect();
      const cardRect = element.closest(".profile-preview")!.getBoundingClientRect();
      return {
        overflowWrap: getComputedStyle(element).overflowWrap,
        wordBreak: getComputedStyle(element).wordBreak,
        firstWordLines: range.getClientRects().length,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        fitsCard: nameRect.left >= cardRect.left && nameRect.right <= cardRect.right,
      };
    });
    expect(nameLayout).toMatchObject({ overflowWrap: "normal", wordBreak: "normal", firstWordLines: 1, fitsCard: true });
    expect(nameLayout.scrollWidth).toBeLessThanOrEqual(nameLayout.clientWidth + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (width === 320) await page.screenshot({ path: "test-results/vibe-profile-dark-cosmic-320.png", fullPage: true });
    if (width === 1440) await page.screenshot({ path: "test-results/vibe-profile-dark-cosmic-1440.png", fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/about");
  await page.emulateMedia({ colorScheme: "dark" });
  await openSettings();
  await page.getByRole("button", { name: "Системная" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Светлая" }).click();
  await page.getByRole("button", { name: "Закрыть окно" }).click();
  await page.getByRole("button", { name: "Настройки" }).click();
  await page.getByRole("button", { name: "Тёмная" }).click();
  await page.getByRole("button", { name: "Закрыть окно" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme-mode", "dark");
  await page.getByRole("button", { name: "Закрыть меню" }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  const aboutHeadingLayout = await page.locator(".about-page > .page-heading").evaluate((element) => {
    const heading = element.querySelector("h1")!.getBoundingClientRect();
    const action = element.querySelector(":scope > .glass-button")!.getBoundingClientRect();
    return { headingHeight: heading.height, headingWidth: heading.width, actionTop: action.top, headingBottom: heading.bottom, scrollWidth: document.documentElement.scrollWidth };
  });
  expect(aboutHeadingLayout.headingHeight).toBeLessThan(40);
  expect(aboutHeadingLayout.actionTop).toBeGreaterThanOrEqual(aboutHeadingLayout.headingBottom);
  expect(aboutHeadingLayout.scrollWidth).toBeLessThanOrEqual(390);
  if (await page.locator(".drawer-backdrop.is-open").count()) {
    await page.getByRole("button", { name: "Закрыть меню" }).click();
    await page.locator(".drawer-backdrop.is-open").waitFor({ state: "detached" });
  }
  await page.screenshot({ path: "test-results/vibe-about-390.png", fullPage: true });
  await page.getByRole("button", { name: "Редактировать страницу" }).click();
  const aboutActions = page.locator(".about-page-actions");
  await expect(aboutActions.getByRole("button", { name: "Отменить" })).toBeVisible();
  await expect(aboutActions.getByRole("button", { name: "Сохранить страницу" })).toBeVisible();
  const aboutActionsLayout = await aboutActions.evaluate((element) => {
    const buttons = Array.from(element.querySelectorAll("button")).map((button) => {
      const rect = button.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width };
    });
    return { buttons, viewportWidth: innerWidth, scrollWidth: document.documentElement.scrollWidth };
  });
  expect(aboutActionsLayout.buttons.every((button) => button.left >= 0 && button.right <= aboutActionsLayout.viewportWidth && button.width > 0)).toBeTruthy();
  expect(aboutActionsLayout.scrollWidth).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/vibe-about-editor-390.png", fullPage: true });
  await page.getByRole("button", { name: "Отменить" }).click();
  await expect(page.getByRole("button", { name: "Редактировать страницу" })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.getByRole("button", { name: "Редактировать страницу" }).click();
  await page.getByLabel("Заголовок").fill("Несохранённое название");
  await page.getByRole("button", { name: "Отменить" }).click();
  await expect(page.locator(".about-page h1", { hasText: "О Вайбе" })).toBeVisible();
  await page.getByRole("button", { name: "Редактировать страницу" }).click();
  await page.getByLabel("Заголовок").fill("О Вайбе · команда проекта");
  await page.getByLabel("Краткое описание проекта").fill(`Миссия Вайба — поддерживать любознательность и личный прогресс. ${"Каждый может пробовать новое и видеть свои усилия. ".repeat(24)}`);

  await page.getByRole("button", { name: "Добавить блок" }).click();
  await page.getByRole("button", { name: "Добавить блок" }).click();
  const sectionCards = page.locator(".about-section-card");
  await sectionCards.nth(0).getByLabel("Заголовок блока").fill("Наша идея");
  await sectionCards.nth(0).getByLabel("Текст").fill("Вайб помогает отмечать старание и реальные шаги вперёд.");
  await sectionCards.nth(1).getByLabel("Заголовок блока").fill("Как появился проект");
  await sectionCards.nth(1).getByLabel("Текст").fill("Мы создаём безопасную среду для школьных инициатив.");
  await sectionCards.nth(1).getByRole("button", { name: "Поднять блок" }).click();
  const memberAdd = page.getByRole("button", { name: "Добавить участника" });
  await memberAdd.click();
  await memberAdd.click();
  const memberCards = page.locator(".about-member-card");
  await memberCards.nth(0).getByLabel("Имя").fill("Участник команды");
  await memberCards.nth(0).getByLabel("Роль").fill("Разработка проекта");
  await memberCards.nth(0).getByLabel("Короткое описание").fill("Помогает превращать идеи команды в полезные функции.");
  await memberCards.nth(1).getByLabel("Имя").fill("Участник проекта");
  await memberCards.nth(1).getByLabel("Роль").fill("Школьные инициативы");
  await memberCards.nth(1).getByLabel("Короткое описание").fill("Собирает предложения о школьной жизни.");
  await memberCards.nth(1).getByRole("button", { name: "Поднять участника" }).click();

  const sectionWithPhotoInput = sectionCards.nth(1);
  const imageInput = sectionWithPhotoInput.getByLabel("Загрузить JPEG, PNG или WebP");
  const svgResponsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/owner/about/images" && response.status() >= 400);
  await imageInput.setInputFiles({ name: "not-an-image.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>") });
  expect((await svgResponsePromise).status()).toBe(415);
  await expect(page.locator(".toast").first()).toContainText("Поддерживаются только корректные JPEG, PNG и WebP");
  const oversizedImageResponsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/owner/about/images" && response.request().method() === "POST");
  await imageInput.setInputFiles({ name: "too-large.png", mimeType: "image/png", buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
  expect((await oversizedImageResponsePromise).status()).toBe(413);
  await expect(page.locator(".toast").first()).toContainText("Изображение больше 10 МБ");
  await imageInput.setInputFiles(photo);
  await expect(sectionWithPhotoInput.locator(".about-image-editor img")).toBeVisible();
  const sectionImageUrl = await sectionWithPhotoInput.locator(".about-image-editor img").getAttribute("src");
  const teamImageInput = memberCards.nth(0).getByLabel("Загрузить JPEG, PNG или WebP");
  await teamImageInput.setInputFiles(photo);
  await expect(memberCards.nth(0).locator(".about-image-editor img")).toBeVisible();
  const teamImageUrl = await memberCards.nth(0).locator(".about-image-editor img").getAttribute("src");

  let saveCount = 0;
  const countSave = (request: import("@playwright/test").Request) => { if (request.method() === "PUT" && new URL(request.url()).pathname === "/api/owner/about") saveCount += 1; };
  page.on("request", countSave);
  await page.route("**/api/owner/about", async (route) => { if (route.request().method() === "PUT") await new Promise((resolveDelay) => setTimeout(resolveDelay, 350)); await route.continue(); });
  await page.getByRole("button", { name: "Сохранить страницу" }).dblclick();
  await expect(page.locator(".toast").first()).toContainText("Страница «О нас» сохранена");
  await page.unroute("**/api/owner/about");
  page.off("request", countSave);
  expect(saveCount).toBe(1);
  let about = await page.request.get("/api/about").then((response) => response.json());
  expect(about.title).toBe("О Вайбе · команда проекта");
  expect(about.sections.map((item: { title: string }) => item.title)).toEqual(["Как появился проект", "Наша идея"]);
  expect(about.teamMembers.map((item: { name: string }) => item.name)).toEqual(["Участник проекта", "Участник команды"]);
  expect(await page.request.get(sectionImageUrl!).then((response) => response.status())).toBe(200);
  expect(await page.request.get(teamImageUrl!).then((response) => response.status())).toBe(200);
  const linkedImageDelete = await page.request.delete(sectionImageUrl!.replace("/api/about/images/", "/api/owner/about/images/"), { headers: await csrfHeader() });
  expect(linkedImageDelete.status()).toBe(409);
  await page.reload();
  await expect(page.locator(".about-page h1")).toHaveText("О Вайбе · команда проекта");
  await expect(page.getByRole("heading", { name: "Как появился проект" })).toBeVisible();
  await expect(page.locator(".about-member-card img")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(await page.locator(".about-team-grid").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(1);
  await page.screenshot({ path: "test-results/vibe-about-dark-390.png", fullPage: true });

  const ownerPage = await page.request.get("/api/about").then((response) => response.json());
  await signInAs("Пользователь 1");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.goto("/about");
  await expect(page.locator(".about-page h1")).toHaveText(ownerPage.title);
  await expect(page.getByRole("button", { name: "Редактировать страницу" })).toHaveCount(0);
  const forgedUpdate = await page.request.put("/api/owner/about", { headers: await csrfHeader(), data: { title: "Чужое изменение", description: "", teamMembers: [], sections: [] } });
  expect(forgedUpdate.status()).toBe(403);
  const lockedAppearance = await page.request.get("/api/profile/customize").then((response) => response.json());
  const lockedFrameUpdate = await page.request.put("/api/profile/appearance", { headers: await csrfHeader(), data: { ...lockedAppearance.appearance, frame: "frame-thin-glass" } });
  expect(lockedFrameUpdate.status()).toBe(403);
  await expect(page.getByRole("heading", { name: "Как появился проект" })).toBeVisible();
  expect(await page.request.get(sectionImageUrl!).then((response) => response.status())).toBe(200);

  await signInAs("Пользователь 2");
  await page.goto("/about");
  await expect(page.getByRole("button", { name: "Редактировать страницу" })).toHaveCount(0);
  expect(await page.request.put("/api/owner/about", { headers: await csrfHeader(), data: { title: ownerPage.title, description: ownerPage.description, teamMembers: [], sections: [] } }).then((response) => response.status())).toBe(403);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await signInAs("Пользователь 3");
  await page.goto("/about");
  await expect(page.getByRole("button", { name: "Редактировать страницу" })).toHaveCount(0);
  expect(await page.request.put("/api/owner/about", { headers: await csrfHeader(), data: { title: ownerPage.title, description: ownerPage.description, teamMembers: [], sections: [] } }).then((response) => response.status())).toBe(403);

  await signInAs("Пользователь 4");
  const prisma = new PrismaClient();
  try {
    const student = await prisma.user.findUniqueOrThrow({ where: { testProfileKey: "user-1" }, include: { memberships: { where: { active: true, approved: true }, take: 1 } } });
    const membership = student.memberships[0]!;
    const appearance = await prisma.profileAppearance.findUniqueOrThrow({ where: { userId: student.id }, select: { frame: true } });
    frameFixture = { userId: student.id, membershipId: membership.id, totalExp: membership.totalExp, frame: appearance.frame };
    await prisma.membership.update({ where: { id: membership.id }, data: { totalExp: 35 } });
    const eligible = await prisma.cosmeticItem.findMany({ where: { unlockLevel: { lte: 6 } }, select: { id: true } });
    const unlocked = new Set((await prisma.cosmeticUnlock.findMany({ where: { userId: student.id }, select: { cosmeticId: true } })).map((item) => item.cosmeticId));
    const missingUnlocks = eligible.filter((item) => !unlocked.has(item.id));
    if (missingUnlocks.length) await prisma.cosmeticUnlock.createMany({ data: missingUnlocks.map((item) => ({ userId: student.id, cosmeticId: item.id, source: "E2E_V8" })) });
  } finally { await prisma.$disconnect(); }
  await signInAs("Пользователь 1");
  await page.goto("/profile/customize");
  await expect(page.locator(".frame-cosmetic-card").filter({ hasText: "Лавандовое сияние" }).first()).toBeVisible();
  const thinFrame = page.locator(".frame-cosmetic-card").filter({ hasText: "Тонкое стекло" });
  await expect(thinFrame.getByRole("button", { name: "Применить" })).toBeEnabled();
  await thinFrame.getByRole("button", { name: "Применить" }).click();
  await expect(page.locator(".toast").first()).toContainText("Оформление сохранено");
  expect(await page.request.get("/api/profile/customize").then((response) => response.json().then((data) => data.appearance.frame))).toBe("frame-thin-glass");
  await page.reload();
  await expect(page.locator(".profile-preview .avatar-wrap")).toHaveClass(/cosmetic-thin-glass/u);
  const drawerTrigger = page.getByRole("button", { name: "Открыть главное меню" });
  await drawerTrigger.click();
  await expect(page.locator(".drawer-profile .avatar-wrap")).toHaveClass(/cosmetic-thin-glass/u);
  await page.getByRole("button", { name: "Завершить сеанс" }).click();
  await expect(page.getByRole("button", { name: "Тест" })).toBeVisible();
  await page.getByRole("button", { name: "Тест" }).click();
  await page.getByRole("button", { name: /Пользователь 1/u }).click();
  await page.waitForURL(/\/tasks$/u);
  expect(await page.request.get("/api/profile/customize").then((response) => response.json().then((data) => data.appearance.frame))).toBe("frame-thin-glass");
  await page.goto("/teacher");
  if (await page.getByRole("button", { name: "Проверить работу" }).count()) {
    await page.getByRole("button", { name: "Проверить работу" }).first().click();
    await expect(page.locator(".review-student .avatar-wrap")).not.toHaveClass(/cosmetic-thin-glass/u);
  }

  await signInAs("Пользователь 4");
  await page.goto("/about");
  await page.getByRole("button", { name: "Редактировать страницу" }).click();
  const sectionWithPhoto = page.locator(".about-section-card").nth(1);
  await sectionWithPhoto.getByRole("button", { name: "Убрать фото" }).click();
  await page.getByRole("button", { name: "Сохранить страницу" }).click();
  await expect(page.locator(".toast").first()).toContainText("Страница «О нас» сохранена");
  expect(await page.request.get(sectionImageUrl!).then((response) => response.status())).toBe(404);
  expect(await page.request.get(teamImageUrl!).then((response) => response.status())).toBe(200);
  about = await page.request.get("/api/about").then((response) => response.json());
  expect(about.sections.find((item: { title: string }) => item.title === "Наша идея").imageAttachmentId).toBeNull();

  await signInAs("Пользователь 1");
  await page.goto("/about");
  await expect(page.getByRole("button", { name: "Редактировать страницу" })).toHaveCount(0);
  expect(await page.request.delete("/api/owner/about/images/not-an-image", { headers: await csrfHeader() }).then((response) => response.status())).toBe(403);

  if (frameFixture) {
    const prisma = new PrismaClient();
    try {
      await prisma.profileAppearance.update({ where: { userId: frameFixture.userId }, data: { frame: frameFixture.frame } });
      await prisma.cosmeticUnlock.deleteMany({ where: { userId: frameFixture.userId, source: "E2E_V8" } });
      await prisma.membership.update({ where: { id: frameFixture.membershipId }, data: { totalExp: frameFixture.totalExp } });
    } finally { await prisma.$disconnect(); }
  }
});
