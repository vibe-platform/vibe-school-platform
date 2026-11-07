import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dataRoot = resolve(root, "data", "e2e-runs");
mkdirSync(dataRoot, { recursive: true });
const runDir = mkdtempSync(join(dataRoot, "run-"));
const dbName = "vibe-e2e.db";
const dbPath = join(runDir, dbName);
const uploadPath = join(runDir, "uploads");
mkdirSync(uploadPath, { recursive: true });
const env = {
  ...process.env,
  NODE_ENV: "development",
  HOST: "127.0.0.1",
  API_PORT: "3101",
  WEB_PORT: "5174",
  PLAYWRIGHT_BASE_URL: "http://127.0.0.1:5174",
  DATABASE_URL: `file:../data/e2e-runs/${basename(runDir)}/${dbName}`,
  UPLOAD_DIR: relative(resolve(root, "apps/api"), uploadPath).replaceAll("\\", "/"),
  DEV_AUTH: "false",
  ENABLE_TEST_LOGIN: "true",
  DEMO_MODE: "true",
  LEGAL_PD_CONSENT_REQUIRED: process.env.E2E_REQUIRE_LEGAL_CONSENT === "true" ? "true" : "false",
  MAX_BOT_ENABLED: "false",
  MAX_BOT_TOKEN: "",
  MAX_TRANSPORT: "mock",
};
process.env.DATABASE_URL = env.DATABASE_URL;
if (!env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) {
  const installedBrowsers = [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  ];
  const installed = installedBrowsers.find(existsSync);
  if (installed) env.PLAYWRIGHT_CHROMIUM_EXECUTABLE = installed;
}
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

try {
  await import("node:fs/promises").then(({ open }) => open(dbPath, "w").then((file) => file.close()));
  execFileSync(npm, ["run", "db:migrate"], { cwd: root, env, stdio: "inherit", shell: process.platform === "win32" });
  execFileSync(npm, ["run", "db:seed:presentation"], { cwd: root, env, stdio: "inherit", shell: process.platform === "win32" });
  const fixtures = new PrismaClient();
  try {
    await fixtures.user.create({ data: { testProfileKey: "qa-owner-admin-candidate", displayName: "Проверочный аккаунт школы", firstName: "Проверочный", lastName: "Аккаунт" } });
  } finally { await fixtures.$disconnect(); }
  const playwrightArgs = ["exec", "playwright", "--", "test", "--config=playwright.config.ts"];
playwrightArgs.push(`--workers=${env.E2E_WORKERS ?? "1"}`);
  if (env.E2E_GREP) playwrightArgs.push("--grep", process.platform === "win32" ? `"${env.E2E_GREP.replaceAll('"', '""')}"` : env.E2E_GREP);
  execFileSync(npm, playwrightArgs, { cwd: root, env, stdio: "inherit", shell: process.platform === "win32" });
  if (!env.E2E_GREP) {
    execFileSync(npm, ["run", "db:seed:presentation"], { cwd: root, env, stdio: "inherit", shell: process.platform === "win32" });
    execFileSync(npm, ["exec", "tsx", "--", "scripts/assert-e2e-state.ts"], { cwd: root, env, stdio: "inherit", shell: process.platform === "win32" });
  }
} catch (error) {
  process.exitCode = 1;
  console.error("Локальный браузерный сценарий завершился с ошибкой.", error instanceof Error ? error.message : error);
} finally {
  const safeRoot = `${resolve(dataRoot)}${sep}`;
  const target = resolve(runDir);
  if (!target.startsWith(safeRoot) || !existsSync(target)) throw new Error("Refusing to remove an unexpected e2e path");
  rmSync(target, { recursive: true, force: true });
}
