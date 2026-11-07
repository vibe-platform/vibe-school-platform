import "dotenv/config";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
mkdirSync(path.resolve(root, "data", "uploads"), { recursive: true });
const envPath = path.resolve(root, ".env");
if (!existsSync(envPath)) {
  const example = `NODE_ENV=development\nHOST=127.0.0.1\nAPI_PORT=3001\nWEB_PORT=5173\nDATABASE_URL="file:../data/vibe.db"\nSESSION_SECRET=${randomBytes(32).toString("hex")}\nDEV_AUTH=true\nENABLE_TEST_LOGIN=false\nDEMO_MODE=false\nLEGAL_PD_CONSENT_REQUIRED=false\nMAX_BOT_TOKEN=\nMAX_BOT_USERNAME=\nMAX_API_BASE_URL=https://platform-api2.max.ru\nMAX_TRANSPORT=mock\nUPLOAD_DIR=./data/uploads\n`;
  writeFileSync(envPath, example, { flag: "wx" });
  console.info("Создан локальный .env с отдельным случайным SESSION_SECRET.");
} else {
  console.info("Локальный .env уже есть; его значения сохранены.");
}

const databaseUrl = process.env.DATABASE_URL ?? "file:../data/vibe.db";
if (!databaseUrl?.startsWith("file:")) throw new Error("Setup is limited to a local SQLite database under this project's data directory.");
const databasePathRaw = decodeURIComponent(databaseUrl.slice("file:".length).split("?")[0]!);
const databasePath = path.resolve(path.isAbsolute(databasePathRaw) ? databasePathRaw : path.resolve(root, "prisma", databasePathRaw));
const dataRoot = path.resolve(root, "data");
const relativeDatabasePath = path.relative(dataRoot, databasePath);
if (relativeDatabasePath.startsWith("..") || path.isAbsolute(relativeDatabasePath)) throw new Error(`Refusing setup outside this project's data directory (${databasePath}).`);
const existingDatabaseHasBytes = existsSync(databasePath) && (await stat(databasePath)).size > 0;

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
execFileSync(npm, ["run", "db:migrate"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
execFileSync(npm, ["run", "db:generate"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
if (existingDatabaseHasBytes) console.info("Существующая база обнаружена: выполнены только миграция и генерация клиента; заполнение seed-данными пропущено.");
else execFileSync(npm, ["run", "db:seed"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
console.info("Локальная база готова. Повторный запуск не очищает и не заполняет существующие данные заново.");
