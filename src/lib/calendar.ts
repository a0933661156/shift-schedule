const WEEKDAY_INDEX: Record<string, number> = {
  日: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
};

export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  const nextYear = Math.floor(index / 12);
  return { year: nextYear, month: index - nextYear * 12 + 1 };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function monthCells(year: number, month: number): Array<number | null> {
  const lead = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const count = daysInMonth(year, month);
  const cells: Array<number | null> = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= count; day += 1) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function resolveYearMonth(
  year: number,
  month: number,
  weekdayOfDay1: string,
): { year: number; month: number } {
  const today = new Date();
  const fallback = { year: today.getFullYear(), month: today.getMonth() + 1 };
  const suggested =
    Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12 && year >= 2000 && year <= 2100
      ? { year, month }
      : fallback;
  const expected = WEEKDAY_INDEX[weekdayOfDay1.trim()];
  if (expected === undefined) return suggested;
  if (new Date(suggested.year, suggested.month - 1, 1).getDay() === expected) return suggested;

  let best = suggested;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let delta = -18; delta <= 18; delta += 1) {
    const candidate = addMonths(suggested.year, suggested.month, delta);
    if (new Date(candidate.year, candidate.month - 1, 1).getDay() !== expected) continue;
    const distance = Math.abs(delta);
    if (distance < bestDistance || (distance === bestDistance && delta > 0)) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}
