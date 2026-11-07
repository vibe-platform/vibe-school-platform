import { expect, test } from "@playwright/test";

// The bridge and MAX response are mocked: no signed launch data or real MAX account is used.
test("MAX logout remains on login and allows switching profiles", async ({ page }) => {
  test.setTimeout(90_000);
  await page.route("**/max-web-app.js", (route) => route.fulfill({ contentType: "application/javascript", body: "if (localStorage.getItem('test-bridge-ready') === '1') window.WebApp = { initData: 'ui-placeholder', initDataUnsafe: { start_param: '' } };" }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    if (localStorage.getItem("test-bridge-ready") === "1") Object.assign(window, { WebApp: { initData: "ui-placeholder", initDataUnsafe: { start_param: "" } } });
  });
  await page.route("**/api/auth/status", (route) => route.fulfill({ json: { maxConfigured: true, maxAppConfigured: true, testLoginEnabled: true } }));
  let maxRequests = 0;
  let allowMax = false;
  await page.route("**/api/auth/max", async (route) => {
    maxRequests += 1;
    if (!allowMax) return route.fulfill({ status: 403, json: { error: "test" } });
    const result = await page.request.post("/api/auth/test/session", { data: { profileKey: "user-1" } });
    expect(result.ok()).toBeTruthy();
    await route.fulfill({ status: 200, json: { ok: true } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Тест" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Пользователь 1/u }).click();
  await expect(page.locator(".app-frame")).toBeVisible();
  await page.evaluate(() => localStorage.setItem("test-bridge-ready", "1"));
  await page.reload();
  await page.getByRole("button", { name: "Открыть главное меню" }).click();
  await page.getByRole("button", { name: "Завершить сеанс" }).click();
  await expect(page.getByRole("button", { name: "Войти через MAX" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(maxRequests).toBe(0);
  expect((await page.request.get("/api/session/me").then((r) => r.json())).authenticated).toBe(false);
  await page.reload();
  await expect(page.getByRole("button", { name: "Тест" })).toBeVisible();
  await page.waitForLoadState("networkidle"); expect(maxRequests).toBe(0);
  await page.getByRole("button", { name: "Тест" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Пользователь 2/u }).click();
  await expect(page.locator(".app-frame")).toBeVisible();
  expect((await page.request.get("/api/session/me").then((r) => r.json())).user.role).toBe("TEACHER");
  await page.getByRole("button", { name: "Открыть главное меню" }).click();
  await page.getByRole("button", { name: "Завершить сеанс" }).click();
  await expect(page.getByRole("button", { name: "Войти через MAX" })).toBeVisible();
  allowMax = true;
  await page.getByRole("button", { name: "Войти через MAX" }).click();
  await expect(page.locator(".app-frame")).toBeVisible();
  expect(maxRequests).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem("vibe_manual_max_login"))).toBeNull();
});

test("MAX first launch still attempts automatic login", async ({ page }) => {
  test.setTimeout(60_000);
  await page.route("**/max-web-app.js", (route) => route.fulfill({ contentType: "application/javascript", body: "window.WebApp = { initData: 'ui-placeholder', initDataUnsafe: { start_param: '' } };" }));
  await page.route("**/api/auth/status", (route) => route.fulfill({ json: { maxConfigured: true, maxAppConfigured: true, testLoginEnabled: true } }));
  let calls = 0;
  await page.route("**/api/auth/max", (route) => { calls += 1; return route.fulfill({ status: 403, json: { error: "test" } }); });
  await page.goto("/");
  await expect.poll(() => calls).toBe(1);
});

test("ADMIN teacher class selection from the teacher panel", async ({ page }) => {
  test.setTimeout(90_000);
  await page.route("**/max-web-app.js", (route) => route.fulfill({ contentType: "application/javascript", body: "" }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Тест" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Пользователь 3/u }).click();
  await expect(page.locator(".app-frame")).toBeVisible();
  await page.getByRole("button", { name: "Открыть главное меню" }).click();
  await expect(page.getByRole("link", { name: "Панель школы" })).toBeVisible();
  await page.getByRole("link", { name: "Кабинет учителя" }).click();
  await expect(page.getByRole("heading", { name: "Кабинет учителя" })).toBeVisible();
  await page.getByRole("button", { name: "Выбрать мои классы" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox", { name: /7A/u }).check();
  await dialog.getByRole("button", { name: "Сохранить классы" }).click();
  await expect(dialog).toHaveCount(0);
  const classes = await page.request.get("/api/teacher/classes").then((r) => r.json());
  expect(classes.some((item: { name: string }) => item.name === "7A")).toBe(true);
  await page.getByRole("button", { name: "Открыть главное меню" }).click();
  await page.getByRole("button", { name: "Завершить сеанс" }).click();
  await page.getByRole("button", { name: "Тест" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Пользователь 3/u }).click();
  await expect(page.locator(".app-frame")).toBeVisible();
});

test("SCHOOL reapplication from join card allows choosing another class", async ({ page, browser, baseURL }) => {
  test.setTimeout(90_000);
  await page.route("**/max-web-app.js", (route) => route.fulfill({ contentType: "application/javascript", body: "" }));
  const adminContext = await browser.newContext({ baseURL });
  try {
    const login = await adminContext.request.post("/api/auth/test/session", { data: { profileKey: "user-3" } }); expect(login.ok()).toBe(true);
    const csrf = (await adminContext.cookies()).find((c) => c.name === "vibe_csrf")!.value;
    const created = await adminContext.request.post("/api/admin/classes", { headers: { "x-csrf-token": csrf }, data: { name: `8Б${Date.now()}` } }); expect(created.ok()).toBe(true);
    const extraClass = await created.json();
    await page.goto("/"); await page.getByRole("button", { name: "Тест" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /Пользователь 1/u }).click();
    await expect(page.locator(".app-frame")).toBeVisible();
    const student = (await page.request.get("/api/session/me").then((r) => r.json())).user;
    const removed = await adminContext.request.post(`/api/admin/memberships/${student.membershipId}/leave`, { headers: { "x-csrf-token": csrf } }); expect(removed.ok()).toBe(true);
    await adminContext.route("**/max-web-app.js", (route) => route.fulfill({ contentType: "application/javascript", body: "" }));
    const adminPage = await adminContext.newPage(); await adminPage.goto("/admin");
    const excluded = adminPage.locator(".admin-users-card tbody tr").filter({ hasText: "Пользователь 1" });
    await expect(excluded).toContainText("Исключён"); await expect(excluded).not.toContainText("Заблокирован");
    await expect(excluded.getByRole("button", { name: "Назначить учителем" })).toHaveCount(0);
    await page.goto("/tasks"); await page.getByRole("link", { name: /Присоединитесь к школе/u }).click();
    await expect(page.getByRole("heading", { name: "Присоединиться к школе" })).toBeVisible();
    await page.getByLabel("Имя", { exact: true }).fill("Тест"); await page.getByLabel("Фамилия", { exact: true }).fill("Ученик");
    const options = await page.request.get("/api/onboarding/options").then((r) => r.json());
    const school = options.schools.find((x: { classes: Array<{ id: string }> }) => x.classes.some((c) => c.id === extraClass.id));
    await page.getByRole("combobox", { name: "Школа", exact: true }).selectOption(school.id, { timeout: 10000 });
    await page.getByRole("combobox", { name: "Класс", exact: true }).selectOption(extraClass.id);
    await page.getByRole("button", { name: "Отправить заявку" }).click();
    await expect(page.getByText(/ожидает подтверждения/u)).toBeVisible();
    await page.getByRole("button", { name: "Изменить класс" }).click();
    await page.getByRole("combobox", { name: "Класс", exact: true }).selectOption(student.class.id);
    await page.getByRole("button", { name: "Отправить заявку" }).click();
    await expect(page.getByText(/ожидает подтверждения/u)).toBeVisible();
    const pending = await page.request.get("/api/onboarding/options").then((r) => r.json());
    expect(pending.pending.classId).toBe(student.class.id);
  } finally { await adminContext.close(); }
});

test("TEACHER self select classes and display them in school panel", async ({ page, browser, baseURL }) => {
  test.setTimeout(90_000);
  await page.route("**/max-web-app.js", (route) => route.fulfill({ contentType: "application/javascript", body: "" }));
  await page.setViewportSize({ width: 390, height: 844 });
  const adminContext = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  await adminContext.route("**/max-web-app.js", (route) => route.fulfill({ contentType: "application/javascript", body: "" }));
  try {
    const login = await adminContext.request.post("/api/auth/test/session", { data: { profileKey: "user-3" } }); expect(login.ok()).toBe(true);
    const csrf = (await adminContext.cookies()).find((c) => c.name === "vibe_csrf")!.value;
    const name = `8Б${Date.now()}`;
    const created = await adminContext.request.post("/api/admin/classes", { headers: { "x-csrf-token": csrf }, data: { name } }); expect(created.ok()).toBe(true);
    await page.goto("/"); await page.getByRole("button", { name: "Тест" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /Пользователь 2/u }).click();
    await expect(page.getByRole("heading", { name: "Кабинет учителя" })).toBeVisible();
    await page.getByRole("button", { name: "Выбрать мои классы" }).click();
    let dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("checkbox", { name: /7A/u })).toBeChecked();
    await dialog.getByRole("checkbox", { name }).check();
    await dialog.getByRole("button", { name: "Сохранить классы" }).click(); await expect(dialog).toHaveCount(0);
    await page.getByRole("button", { name: "Выбрать мои классы" }).click(); dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("checkbox", { name })).toBeChecked();
    await dialog.getByRole("checkbox", { name: /7A/u }).uncheck();
    await dialog.getByRole("button", { name: "Сохранить классы" }).click(); await expect(dialog).toHaveCount(0);
    const classes = await page.request.get("/api/teacher/classes").then((r) => r.json());
    expect(classes.map((row: { name: string }) => row.name)).toEqual([name]);
    const adminPage = await adminContext.newPage(); await adminPage.goto("/admin");
    const row = adminPage.locator(".admin-users-card tbody tr").filter({ hasText: "Пользователь 2" });
    await expect(row).toContainText(name); await expect(row).toContainText("Учитель");
    const admin = adminPage.locator(".admin-users-card tbody tr").filter({ hasText: "Пользователь 3" });
    await expect(admin).toContainText("Администратор"); await expect(admin).toContainText("Активен");
    await expect(admin).not.toContainText("Доступ администратора школы нельзя изменить здесь");
    expect(await admin.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  } finally { await adminContext.close(); }
});

test("TASK delete confirmation hides a teacher assignment", async ({ page, browser, baseURL }) => {
  test.setTimeout(90_000);
  await page.route("**/max-web-app.js", (route) => route.fulfill({ contentType: "application/javascript", body: "" }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/"); await page.getByRole("button", { name: "Тест" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Пользователь 2/u }).click();
  await expect(page.getByRole("heading", { name: "Кабинет учителя" })).toBeVisible();
  const csrf = (await page.context().cookies()).find((item) => item.name === "vibe_csrf")!.value;
  const classes = await page.request.get("/api/teacher/classes").then((r) => r.json());
  const created = await page.request.post("/api/teacher/assignments", { headers: { "x-csrf-token": csrf }, data: { title: "Проверка удаления", subject: "Математика", category: "Учёба", description: "Тест", classIds: [classes[0].id], questions: [{ prompt: "1+1?", type: "NUMBER", points: 1, acceptedAnswers: ["2"] }], publish: true } });
  expect(created.status()).toBe(201); const id = (await created.json()).id as string;
  await page.reload(); await page.getByRole("tab", { name: /Мои задания/u }).click();
  const row = page.locator(".teacher-assignment-row").filter({ hasText: "Проверка удаления" });
  await expect(row).toBeVisible();
  expect(await row.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await row.getByRole("button", { name: "Удалить задание Проверка удаления" }).click();
  let dialog = page.getByRole("dialog"); await expect(dialog).toContainText("Уже отправленные работы и начисления сохранятся");
  await dialog.getByRole("button", { name: "Отмена" }).click(); await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Удалить задание Проверка удаления" }).click();
  dialog = page.getByRole("dialog"); await dialog.getByRole("button", { name: "Удалить задание", exact: true }).click();
  await expect(row).toHaveCount(0);
  const own = await page.request.get("/api/teacher/assignments").then((r) => r.json()); expect(own.some((item: { id: string }) => item.id === id)).toBe(false);
  const student = await browser.newContext({ baseURL });
  try { expect((await student.request.post("/api/auth/test/session", { data: { profileKey: "user-1" } })).ok()).toBe(true); expect((await student.request.get(`/api/tasks/${id}`)).status()).toBe(404); }
  finally { await student.close(); }
});

test("MAX notification preference toggle saves both states", async ({ page }) => {
  test.setTimeout(90_000);
  await page.route("**/max-web-app.js", (route) => route.fulfill({ contentType: "application/javascript", body: "" }));
  await page.goto("/"); await page.getByRole("button", { name: "Тест" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Пользователь 1/u }).click();
  await expect(page.locator(".app-frame")).toBeVisible();
  await page.getByRole("button", { name: "Открыть главное меню" }).click();
  await page.getByRole("button", { name: "Настройки" }).click();
  const toggle = page.getByRole("checkbox", { name: "Уведомления в MAX" });
  await toggle.click(); await expect(toggle).toBeChecked();
  await expect.poll(async () => (await page.request.get("/api/profile").then((r) => r.json())).preferences.maxNotificationsEnabled).toBe(true);
  await expect(toggle).toBeEnabled(); await toggle.click(); await expect(toggle).not.toBeChecked();
  await expect.poll(async () => (await page.request.get("/api/profile").then((r) => r.json())).preferences.maxNotificationsEnabled).toBe(false);
});
