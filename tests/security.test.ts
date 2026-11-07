import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { isSyntheticDataSession, isTestLoginEnabled, validateMaxInitData } from "../apps/api/src/security.js";

function signedInitData(token: string, authDate: number) {
  const entries = [
    ["user", JSON.stringify({ id: 9_100_000_000_000_01, first_name: "Аня", last_name: "Смирнова", username: "anya" })],
    ["auth_date", String(authDate)],
    ["start_param", "vibe:challenge"],
  ] as const;
  const dataCheck = [...entries].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secret).update(dataCheck).digest("hex");
  return `${entries.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&")}&hash=${hash}`;
}

describe("MAX initData validation", () => {
  const now = Date.UTC(2026, 9, 1, 12);
  const token = "local-test-token";

  it("accepts a current, correctly signed payload and preserves the numeric user id", () => {
    const payload = signedInitData(token, Math.floor(now / 1000));
    expect(validateMaxInitData(payload, token, now)).toMatchObject({ maxUserId: "910000000000001", firstName: "Аня", lastName: "Смирнова" });
  });

  it("rejects tampering, duplicate keys, missing tokens, and expired payloads", () => {
    const current = signedInitData(token, Math.floor(now / 1000));
    const tampered = current.replace(/hash=([a-f0-9]{64})/u, (_match, hash: string) => `hash=${hash[0] === "0" ? "1" : "0"}${hash.slice(1)}`);
    expect(validateMaxInitData(tampered, token, now)).toBeNull();
    expect(validateMaxInitData(`${current}&auth_date=${Math.floor(now / 1000)}`, token, now)).toBeNull();
    expect(validateMaxInitData(current, "", now)).toBeNull();
    const stale = signedInitData(token, Math.floor(now / 1000) - 3601);
    expect(validateMaxInitData(stale, token, now)).toBeNull();
  });
});

describe("test profile access", () => {
  it("enables public test profiles in production only when explicitly configured", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ENABLE_TEST_LOGIN", "");
    vi.stubEnv("DEMO_MODE", "");
    expect(isTestLoginEnabled()).toBe(false);
    vi.stubEnv("ENABLE_TEST_LOGIN", "true");
    expect(isTestLoginEnabled()).toBe(true);
    vi.stubEnv("ENABLE_TEST_LOGIN", "");
    vi.stubEnv("DEMO_MODE", "true");
    expect(isTestLoginEnabled()).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(isTestLoginEnabled()).toBe(false);
    vi.stubEnv("ENABLE_TEST_LOGIN", "true");
    expect(isTestLoginEnabled()).toBe(true);
    vi.unstubAllEnvs();
  });

  it("uses test login only to scope demo-school data, never to reduce owner access", () => {
    const owner = { authSource: "TEST", user: { platformRole: "PROJECT_OWNER" } } as never;
    const teacher = { authSource: "TEST", user: { platformRole: null } } as never;
    expect(isSyntheticDataSession(owner)).toBe(false);
    expect(isSyntheticDataSession(teacher)).toBe(true);
  });
});
