import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './contest-checks', testMatch: 'pdf-mobile.spec.ts', reporter: 'list', use: { baseURL: 'http://127.0.0.1:3101', browserName: 'chromium', headless: true } });
