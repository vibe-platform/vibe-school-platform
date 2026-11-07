import "dotenv/config";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const rawUrl = process.env.DATABASE_URL;
if (!rawUrl?.startsWith("file:")) throw new Error("Reset refused: DATABASE_URL must point to a local disposable SQLite database.");
const rawPath = decodeURIComponent(rawUrl.slice("file:".length).split("?")[0]!);
const databasePath = path.resolve(path.isAbsolute(rawPath) ? rawPath : path.resolve(root, "prisma", rawPath));
const disposableRoot = path.resolve(root, "data", "e2e-runs");
const relative = path.relative(disposableRoot, databasePath);
if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Reset refused for ${databasePath}. Only a disposable database under data/e2e-runs can be reset.`);
if (process.env.ALLOW_QA_RESET !== "1") throw new Error("Reset refused. To reset only a disposable QA database, set ALLOW_QA_RESET=1 explicitly.");

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
execFileSync(npm, ["exec", "prisma", "--", "migrate", "reset", "--force"], { cwd: root, stdio: "inherit", env: process.env, shell: process.platform === "win32" });
