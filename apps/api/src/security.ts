import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Membership, Role, User } from "@prisma/client";
import { prisma } from "./db.js";

export type AuthContext = { user: User; membership: Membership | null; authSource: "MAX" | "TEST" };
export const sessionCookie = "vibe_session";
export const csrfCookie = "vibe_csrf";
export const browserCookie = "vibe_login_browser";
const hash = (input: string) => createHash("sha256").update(input).digest("hex");
export const isTestLoginEnabled = () => process.env.ENABLE_TEST_LOGIN === "true" || (process.env.NODE_ENV !== "production" && process.env.DEMO_MODE === "true");

/** Test login scopes global demo content; access to a school is determined by its membership. */
export function isSyntheticDataSession(context: Pick<AuthContext, "authSource" | "user"> | null | undefined) {
  return context?.authSource === "TEST" && context.user.platformRole !== "PROJECT_OWNER";
}

export async function authenticate(req: FastifyRequest): Promise<AuthContext | null> {
  const token = req.cookies[sessionCookie];
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hash(token) },
    include: { user: { include: { memberships: { where: { active: true, approved: true }, orderBy: { createdAt: "asc" }, take: 1 } } } },
  });
  if (!session || session.expiresAt <= new Date() || session.user.isBlocked) return null;
  if (session.authSource === "TEST" && (!isTestLoginEnabled() || !session.user.testProfileKey)) return null;
  if (session.authSource !== "TEST" && session.user.testProfileKey) return null;
  const membership = session.user.memberships[0] ?? null;
  if (membership && !membership.active) return null;
  return { user: session.user, membership, authSource: session.authSource === "TEST" ? "TEST" : "MAX" };
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<AuthContext | null> {
  const context = await authenticate(req);
  if (!context) {
    await reply.code(401).send({ error: "Требуется вход" });
    return null;
  }
  return context;
}

export async function requireRole(
  req: FastifyRequest,
  reply: FastifyReply,
  roles: Role[],
): Promise<AuthContext | null> {
  const context = await requireAuth(req, reply);
  if (!context) return null;
  const globalOwner = context.user.platformRole === "PROJECT_OWNER";
  const membership = context.membership;
  const allowed = (globalOwner && roles.includes("PROJECT_OWNER")) || Boolean(
    membership && (
      (roles.includes("STUDENT") && membership.role === "STUDENT") ||
      (roles.includes("TEACHER") && (membership.role === "TEACHER" || membership.isTeacher || membership.role === "SCHOOL_ADMIN" || membership.isSchoolAdmin)) ||
      (roles.includes("SCHOOL_ADMIN") && (membership.role === "SCHOOL_ADMIN" || membership.isSchoolAdmin))
    ),
  );
  if (!allowed) {
    await reply.code(403).send({ error: "Нет доступа к этому разделу" });
    return null;
  }
  if (context.membership && !globalOwner && roles.some((role) => role === "STUDENT" || role === "TEACHER" || role === "SCHOOL_ADMIN")) {
    const school = await prisma.school.findUnique({ where: { id: context.membership.schoolId }, select: { archivedAt: true } });
    if (!school || school.archivedAt) {
      await reply.code(403).send({ error: school?.archivedAt ? "Школа находится в архиве. История профиля сохранена, новые действия недоступны." : "Школа недоступна" });
      return null;
    }
  }
  return context;
}

export function setSessionCookies(reply: FastifyReply, token: string) {
  const secure = process.env.NODE_ENV === "production";
  reply.setCookie(sessionCookie, token, { httpOnly: true, sameSite: "strict", secure, path: "/", maxAge: 60 * 60 * 24 * 14 });
  reply.setCookie(csrfCookie, randomBytes(24).toString("base64url"), { httpOnly: false, sameSite: "strict", secure, path: "/", maxAge: 60 * 60 * 24 * 14 });
}

export async function issueSession(userId: string, reply: FastifyReply, authSource: "MAX" | "TEST" = "MAX") {
  const token = randomBytes(32).toString("base64url");
  await prisma.session.create({ data: { userId, authSource, tokenHash: hash(token), expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) } });
  setSessionCookies(reply, token);
}

export function clearSessionCookies(reply: FastifyReply) {
  reply.clearCookie(sessionCookie, { path: "/" });
  reply.clearCookie(csrfCookie, { path: "/" });
  reply.clearCookie(browserCookie, { path: "/" });
}

export function validateMaxInitData(initData: string, botToken: string, now = Date.now(), maxAgeSeconds = 3600) {
  if (!initData || initData.length > 16_384 || !botToken) return null;
  const params = new URLSearchParams(initData);
  const values = new Map<string, string>();
  for (const [key, value] of params.entries()) {
    if (values.has(key) || !/^[a-z_]+$/u.test(key)) return null;
    values.set(key, value);
  }
  const allowed = new Set(["hash", "auth_date", "user", "chat", "ip", "query_id", "start_param", "can_send_after", "chat_type", "receiver", "chat_instance"]);
  if ([...values.keys()].some((key) => !allowed.has(key))) return null;
  const receivedHash = values.get("hash");
  const authDate = Number(values.get("auth_date"));
  const userJson = values.get("user");
  if (!receivedHash || !/^[a-f0-9]{64}$/iu.test(receivedHash) || !Number.isInteger(authDate) || !userJson) return null;
  const age = Math.floor(now / 1000) - authDate;
  if (age < -60 || age > maxAgeSeconds) return null;
  let user: Record<string, unknown>;
  try { user = JSON.parse(userJson) as Record<string, unknown>; } catch { return null; }
  const idMatch = userJson.match(/"id"\s*:\s*(?:"(\d+)"|(\d+))\s*(?=[,}])/u);
  const idRaw = idMatch?.[1] ?? idMatch?.[2];
  if (!idRaw || !/^\d{1,20}$/u.test(idRaw) || BigInt(idRaw) <= 0n || typeof user.first_name !== "string" || !user.first_name.trim() || user.first_name.length > 256) return null;
  if (user.last_name !== undefined && user.last_name !== null && (typeof user.last_name !== "string" || user.last_name.length > 256)) return null;
  if (user.username !== undefined && user.username !== null && (typeof user.username !== "string" || user.username.length > 100)) return null;
  const safeAvatar = (value: unknown) => {
    if (typeof value !== "string" || value.length > 2048) return null;
    try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null; }
    catch { return null; }
  };
  const signData = [...values.entries()].filter(([key]) => key !== "hash").sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(signData).digest();
  const actual = Buffer.from(receivedHash, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  return {
    maxUserId: BigInt(idRaw).toString(),
    firstName: user.first_name,
    lastName: typeof user.last_name === "string" ? user.last_name : "",
    username: typeof user.username === "string" ? user.username : null,
    avatarUrl: safeAvatar(user.photo_url),
    fullAvatarUrl: safeAvatar(user.full_avatar_url),
  };
}

export const sha256 = hash;
