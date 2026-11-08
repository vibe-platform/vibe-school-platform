import { test, expect } from '@playwright/test';
for (const width of [390, 1280]) {
  test('PDF rendering at viewport ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/documents');
    await expect(page.getByRole('heading', { name: 'Документы проекта' })).toBeVisible();
    const cards = page.locator('.document-card');
    await expect(cards).toHaveCount(4);
    await cards.first().getByRole('button', { name: 'Открыть' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/Страниц: [0-9]+/)).toBeVisible();
    const scroller = dialog.getByLabel('Страницы документа');
    const canvas = dialog.locator('canvas').first();
    await expect(canvas).toBeVisible();
    if (width >= 768) {
      await expect.poll(async () => canvas.evaluate((el) => { const c = el as HTMLCanvasElement; const panel = c.closest('[aria-label="Страницы документа"]'); return c.getBoundingClientRect().height - (panel?.getBoundingClientRect().height ?? 0); })).toBeLessThanOrEqual(0);
    }
    await expect.poll(async () => canvas.evaluate((el) => (el as HTMLCanvasElement).width)).toBeGreaterThan(100);
    await expect.poll(async () => canvas.evaluate((el) => { const c = el as HTMLCanvasElement; const ctx = c.getContext('2d'); if (!ctx) return 0; const pixels = ctx.getImageData(0, 0, c.width, c.height).data; let painted = 0; for (let i=3; i<pixels.length; i+=4) if (pixels[i]) painted++; return painted; })).toBeGreaterThan(1000);
    await expect(dialog.getByRole('button', { name: 'Вперёд' })).toHaveCount(0);
    await dialog.locator('div[aria-label="Страница 2"]').scrollIntoViewIfNeeded();
    await expect.poll(async () => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
    await expect(dialog.locator('canvas[aria-label="Страница 2"]')).toBeVisible();
    await dialog.getByRole('button', { name: 'Увеличить' }).click();
    await expect(dialog.getByRole('link', { name: 'Скачать документ' })).toBeVisible();
  });
}

test('MAX Bridge downloads from card and document viewer', async ({ page }) => {
  await page.goto('/documents');
  const cards = page.locator('.document-card');
  await expect(cards).toHaveCount(4);
  await page.evaluate(() => {
    const target = window as unknown as { WebApp: unknown; __downloadCalls: Array<{ url: string; name: string }> };
    target.__downloadCalls = [];
    target.WebApp = { initData: 'test-mini-app', downloadFile: (url: string, name: string) => { target.__downloadCalls.push({ url, name }); return Promise.resolve({ status: 'downloading' }); } };
  });
  await cards.first().getByRole('link', { name: 'Скачать' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __downloadCalls: Array<unknown> }).__downloadCalls.length)).toBe(1);
  const first = await page.evaluate(() => (window as unknown as { __downloadCalls: Array<{ url: string; name: string }> }).__downloadCalls[0]);
  expect(first?.url.startsWith('http://127.0.0.1:3101/api/documents/')).toBe(true);
  expect(first?.url.endsWith('/file?download=1')).toBe(true);
  expect(first?.name).toMatch(/\.pdf$/i);
  await cards.first().getByRole('button', { name: 'Открыть' }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'Скачать документ' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __downloadCalls: Array<unknown> }).__downloadCalls.length)).toBe(2);
});
