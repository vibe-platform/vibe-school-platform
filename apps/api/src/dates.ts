export function localDateKey(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function mondayOfWeek(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const localMidnight = new Date(`${value("year")}-${value("month")}-${value("day")}T00:00:00Z`);
  const weekday = localMidnight.getUTCDay() || 7;
  localMidnight.setUTCDate(localMidnight.getUTCDate() - weekday + 1);
  return localMidnight.toISOString().slice(0, 10);
}

export function dayDistance(fromDay: string, toDay: string) {
  return Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 86_400_000);
}

export function streakAt(day: string, activeDays: Set<string>) {
  let streak = 0;
  let cursor = day;
  while (activeDays.has(cursor)) {
    streak += 1;
    const prior = new Date(`${cursor}T00:00:00Z`);
    prior.setUTCDate(prior.getUTCDate() - 1);
    cursor = prior.toISOString().slice(0, 10);
  }
  return streak;
}

export function pendingActivityDayKeys(submittedAt: readonly (Date | null)[], confirmedDays: Set<string>, timezone: string) {
  return [...new Set(submittedAt.filter((date): date is Date => date !== null).map((date) => localDateKey(date, timezone)).filter((dayKey) => !confirmedDays.has(dayKey)))].sort();
}
