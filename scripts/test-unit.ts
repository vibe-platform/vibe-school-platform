import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dataRoot = resolve(root, "data", "e2e-runs");
mkdirSync(dataRoot, { recursive: true });
const runDir = mkdtempSync(join(dataRoot, "unit-"));
const dbName = "vibe-unit.db";
const dbPath = join(runDir, dbName);
const uploads = join(runDir, "uploads");
mkdirSync(uploads, { recursive: true });
writeFileSync(dbPath, "");
const env = {
  ...process.env,
  NODE_ENV: "test",
  DATABASE_URL: `file:../data/e2e-runs/${basename(runDir)}/${dbName}`,
  UPLOAD_DIR: `data/e2e-runs/${basename(runDir)}/uploads`,
  DEV_AUTH: "false",
  ENABLE_TEST_LOGIN: "true",
  DEMO_MODE: "true",
  LEGAL_PD_CONSENT_REQUIRED: "false",
  MAX_BOT_ENABLED: "false",
  MAX_BOT_TOKEN: "",
  MAX_TRANSPORT: "mock",
};
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

try {
  execFileSync(npm, ["run", "db:migrate"], { cwd: root, env, stdio: "inherit", shell: process.platform === "win32" });
  execFileSync(npm, ["run", "db:seed:presentation"], { cwd: root, env, stdio: "inherit", shell: process.platform === "win32" });
    execFileSync(npm, ["exec", "vitest", "--", "run", "--pool=forks", "--maxWorkers=1"], { cwd: root, env, stdio: "inherit", shell: process.platform === "win32" });
} catch (error) {
  process.exitCode = 1;
  console.error("Локальный unit/integration прогон завершился с ошибкой.", error instanceof Error ? error.message : error);
} finally {
  const safeRoot = `${resolve(dataRoot)}${sep}`;
  const target = resolve(runDir);
  if (!target.startsWith(safeRoot) || !existsSync(target)) throw new Error("Refusing to remove an unexpected unit-test path");
  rmSync(target, { recursive: true, force: true });
}
