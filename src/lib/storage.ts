import type { DayShift, MonthSchedule, Settings, ShiftCode } from "../types.ts";
import { isShiftCode } from "./shifts.ts";

const SETTINGS_KEY = "nursing-schedule:settings";

export const DEFAULT_SETTINGS: Settings = {
  personName: "常怡然",
  accessPassword: "",
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      personName:
        typeof parsed.personName === "string" && parsed.personName.trim()
          ? parsed.personName.trim()
          : DEFAULT_SETTINGS.personName,
      accessPassword: typeof parsed.accessPassword === "string" ? parsed.accessPassword : "",
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  const next: Settings = {
    personName: settings.personName.trim() || DEFAULT_SETTINGS.personName,
    accessPassword: settings.accessPassword.trim(),
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
}

function scheduleKey(personName: string, year: number, month: number): string {
  return `nursing-schedule:data:${encodeURIComponent(personName)}:${year}-${String(month).padStart(2, "0")}`;
}

export function loadSchedule(personName: string, year: number, month: number): MonthSchedule | null {
  try {
    const raw = localStorage.getItem(scheduleKey(personName, year, month));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MonthSchedule>;
    const days: Record<number, DayShift> = {};
    if (parsed.days && typeof parsed.days === "object") {
      for (const [dayKey, value] of Object.entries(parsed.days)) {
        const day = Number(dayKey);
        if (!Number.isInteger(day) || day < 1 || day > 31 || !value || typeof value !== "object") continue;
        const shift = value as Partial<DayShift>;
        if (typeof shift.code !== "string" || !isShiftCode(shift.code) || typeof shift.raw !== "string") continue;
        days[day] = { code: shift.code, raw: shift.raw };
      }
    }
    return {
      year,
      month,
      personName,
      days,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function saveSchedule(schedule: MonthSchedule): void {
  localStorage.setItem(scheduleKey(schedule.personName, schedule.year, schedule.month), JSON.stringify(schedule));
}

export function clearSchedule(personName: string, year: number, month: number): void {
  localStorage.removeItem(scheduleKey(personName, year, month));
}

export function withDay(schedule: MonthSchedule, day: number, code: ShiftCode | null): MonthSchedule {
  const days = { ...schedule.days };
  if (code === null) {
    delete days[day];
  } else {
    days[day] = { code, raw: days[day]?.raw ?? "" };
  }
  return { ...schedule, days, updatedAt: new Date().toISOString() };
}
