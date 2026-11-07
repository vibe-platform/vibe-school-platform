import { describe, expect, it } from "vitest";
import { nextAllowedNotificationTime } from "../apps/api/src/notifications.js";

describe("personal notification quiet hours", () => {
  it("defers an overnight quiet-hour message to the user's local end time", () => {
    const now = new Date(Date.UTC(2026, 9, 1, 20, 30));                   
    const next = nextAllowedNotificationTime(now, "Europe/Moscow", true, "22:00", "08:00");
    expect(next.toISOString()).toBe("2026-10-02T05:00:00.000Z");
  });

  it("leaves messages alone when quiet hours are disabled", () => {
    const now = new Date(Date.UTC(2026, 9, 1, 20, 30));
    expect(nextAllowedNotificationTime(now, "Europe/Moscow", false, "22:00", "08:00")).toBe(now);
  });
});
