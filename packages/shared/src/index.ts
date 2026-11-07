export const cosmeticThresholds = [3, 8, 15, 24, 35, 48, 63, 80, 99] as const;

export function levelForExp(totalExp: number): number {
  if (!Number.isFinite(totalExp) || totalExp < 0) return 1;
  return Math.max(1, Math.floor(Math.sqrt(Math.floor(totalExp) + 1)));
}

export function expProgress(totalExp: number) {
  const level = levelForExp(totalExp);
  const currentThreshold = level * level - 1;
  const nextThreshold = (level + 1) * (level + 1) - 1;
  return {
    level,
    current: Math.max(0, totalExp - currentThreshold),
    needed: nextThreshold - currentThreshold,
    remaining: Math.max(0, nextThreshold - totalExp),
    nextThreshold,
  };
}

export function streakBonusTenths(streakDays: number): number {
  return Math.min(5, Math.max(0, Math.floor((streakDays - 1) / 2)));
}

export const rewardPolicyVersion = "GRADE_STREAK_V2" as const;

export function rewardForBaseAndStreak(baseReward: number, streakDays: number) {
  if (![5, 10].includes(baseReward)) throw new RangeError("Основа награды должна быть 5 или 10 Эйнштейнов");
  const bonusTenths = streakBonusTenths(streakDays);
  const multiplierTenths = 10 + bonusTenths;
  const einsteins = Math.floor((baseReward * multiplierTenths + 5) / 10);
  return { baseReward, bonusTenths, multiplierTenths, einsteins, exp: 1 };
}

export function rewardForGradeAndStreak(grade: number | null | undefined, streakDays: number) {
  if (!Number.isInteger(grade) || grade === null || grade === undefined || grade < 2 || grade > 5) return null;
  const baseReward = grade >= 4 ? 10 : 5;
  return { grade, ...rewardForBaseAndStreak(baseReward, streakDays) };
}

export function normalizeAnswer(input: string, options: { ignoreCase: boolean; trimWhitespace: boolean }) {
  const normalized = options.trimWhitespace ? input.trim().replace(/\s+/gu, " ") : input;
  return options.ignoreCase ? normalized.toLocaleLowerCase("ru-RU") : normalized;
}

export function gradeFromPercent(percent: number): number {
  if (percent >= 85) return 5;
  if (percent >= 70) return 4;
  if (percent >= 50) return 3;
  return 2;
}

export function numericAnswerMatches(answer: string, expected: number, tolerance = 0): boolean {
  const normalized = answer.trim().replace(",", ".");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(normalized)) return false;
  const value = Number(normalized);
  return Number.isFinite(value) && Math.abs(value - expected) <= Math.max(0, tolerance);
}

export function mondayWeekKey(date: Date, timeZone = "Europe/Moscow"): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const local = new Date(`${get("year")}-${get("month")}-${get("day")}T00:00:00Z`);
  const weekday = local.getUTCDay() || 7;
  local.setUTCDate(local.getUTCDate() - weekday + 1);
  return local.toISOString().slice(0, 10);
}

export function nextLevelDescription(level: number) {
  const nextLevel = level + 1;
  const labels: Record<number, string> = {
    2: "набор эмодзи «Искра»",
    3: "новые фоны профиля",
    4: "рамки профиля",
    5: "личные подписи",
    6: "фоны «Северное сияние» и «Лунный свет»",
    7: "набор эмодзи «Интересы»",
    8: "рамки «Голограмма» и «Кристалл»",
    9: "узоры «Пузырьки», «Искры» и «Созвездия»",
    10: "комплект «Космос»",
  };
  return labels[nextLevel] ?? `новые открытия уровня ${nextLevel}`;
}
