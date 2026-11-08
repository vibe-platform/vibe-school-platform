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
    await expect(dialog.getByText(/Страница 1 из/)).toBeVisible();
    const canvas = dialog.locator('canvas');
    await expect(canvas).toBeVisible();
    await expect.poll(async () => canvas.evaluate((el) => (el as HTMLCanvasElement).width)).toBeGreaterThan(100);
    await expect.poll(async () => canvas.evaluate((el) => { const c = el as HTMLCanvasElement; const ctx = c.getContext('2d'); if (!ctx) return 0; const pixels = ctx.getImageData(0, 0, c.width, c.height).data; let painted = 0; for (let i=3; i<pixels.length; i+=4) if (pixels[i]) painted++; return painted; })).toBeGreaterThan(1000);
    await expect(dialog.getByText(/Страница 1 из [2-9]/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Вперёд' }).click();
    await expect(dialog.getByText(/Страница 2 из/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Увеличить' }).click();
    await expect(dialog.getByRole('link', { name: 'Скачать документ' })).toBeVisible();
  });
}
