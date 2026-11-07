import { describe, expect, it } from "vitest";
import { cosmeticThresholds, expProgress, gradeFromPercent, levelForExp, normalizeAnswer, numericAnswerMatches, rewardForBaseAndStreak, rewardForGradeAndStreak } from "./index.js";

describe("personal progression", () => {
  it("opens cosmetic levels at the specified EXP thresholds", () => {
    expect(cosmeticThresholds.map(levelForExp)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(levelForExp(0)).toBe(1);
    expect(levelForExp(98)).toBe(9);
    expect(levelForExp(99)).toBe(10);
    const boundaries = [3, 8, 15, 24, 35, 48, 63, 80, 99];
    for (const [index, threshold] of boundaries.entries()) {
      expect(levelForExp(threshold - 1)).toBe(index + 1);
      expect(levelForExp(threshold)).toBe(index + 2);
      expect(levelForExp(threshold + 1)).toBe(index + 2);
    }
  });

  it("reports progress to the next personal level", () => {
    expect(expProgress(7)).toMatchObject({ level: 2, current: 4, needed: 5, remaining: 1, nextThreshold: 8 });
    expect(expProgress(6)).toMatchObject({ level: 2, current: 3, needed: 5, remaining: 2, nextThreshold: 8 });
    expect(expProgress(8)).toMatchObject({ level: 3, current: 0, needed: 7, remaining: 7, nextThreshold: 15 });
    expect(expProgress(99).level).toBe(10);
  });

  it("applies each streak multiplier to the grade-based reward using integer half-up rounding", () => {
    const high = Array.from({ length: 13 }, (_, index) => rewardForGradeAndStreak(5, index + 1)!.einsteins);
    const low = Array.from({ length: 13 }, (_, index) => rewardForGradeAndStreak(3, index + 1)!.einsteins);
    expect(high).toEqual([10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15, 15]);
    expect(low).toEqual([5, 5, 6, 6, 6, 6, 7, 7, 7, 7, 8, 8, 8]);
    expect(high.reduce((sum, amount) => sum + amount, 0)).toBe(165);
    expect(low.reduce((sum, amount) => sum + amount, 0)).toBe(86);
    expect(rewardForGradeAndStreak(4, 3)).toMatchObject({ grade: 4, baseReward: 10, multiplierTenths: 11, einsteins: 11, exp: 1 });
    expect(rewardForGradeAndStreak(3, 3)).toMatchObject({ grade: 3, baseReward: 5, multiplierTenths: 11, einsteins: 6, exp: 1 });
    expect(rewardForBaseAndStreak(5, 5).einsteins).toBe(6);
    expect(rewardForBaseAndStreak(5, 11).einsteins).toBe(8);
    expect(rewardForGradeAndStreak(null, 3)).toBeNull();
    expect(rewardForGradeAndStreak(1, 3)).toBeNull();
    expect(rewardForGradeAndStreak(6, 3)).toBeNull();
    expect(rewardForGradeAndStreak(3.5, 3)).toBeNull();
  });
});

describe("answer evaluation", () => {
  it("normalizes text consistently in Russian locale", () => {
    expect(normalizeAnswer("  ЁЖ   и   ЛИСА ", { ignoreCase: true, trimWhitespace: true })).toBe("ёж и лиса");
  });

  it("accepts decimal commas only within the configured tolerance", () => {
    expect(numericAnswerMatches(" 3,14 ", 3.1, 0.05)).toBe(true);
    expect(numericAnswerMatches("3,14", 3.1, 0.01)).toBe(false);
    expect(numericAnswerMatches("3x", 3)).toBe(false);
  });

  it("uses the documented grade boundaries", () => {
    expect([0, 49.99, 50, 69.99, 70, 84.99, 85, 100].map(gradeFromPercent)).toEqual([2, 2, 3, 3, 4, 4, 5, 5]);
  });
});
