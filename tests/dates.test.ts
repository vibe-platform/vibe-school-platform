import { describe, expect, it } from "vitest";
import { dayDistance, localDateKey, pendingActivityDayKeys, streakAt } from "../apps/api/src/dates.js";

describe("school calendar and confirmed streak days", () => {
  it("uses school-local submission dates at UTC boundaries", () => {
    expect(localDateKey(new Date("2026-02-01T21:30:00.000Z"), "Europe/Moscow")).toBe("2026-02-02");
    expect(localDateKey(new Date("2026-02-02T20:59:59.999Z"), "Europe/Moscow")).toBe("2026-02-02");
    expect(dayDistance("2026-02-02", "2026-02-03")).toBe(1);
  });

  it("counts only confirmed consecutive days and keeps pending dates separate", () => {
    const confirmed = new Set(["2026-02-02", "2026-02-03"]);
    expect(streakAt("2026-02-03", confirmed)).toBe(2);
    expect(streakAt("2026-02-05", confirmed)).toBe(0);
    expect(pendingActivityDayKeys([
      new Date("2026-02-01T21:30:00.000Z"),
      new Date("2026-02-02T10:00:00.000Z"),
      new Date("2026-02-03T21:30:00.000Z"),
      null,
    ], confirmed, "Europe/Moscow")).toEqual(["2026-02-04"]);
  });
});
