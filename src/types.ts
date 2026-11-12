export const SHIFT_CODES = ["課", "off", "0-8", "16-0", "8-16"] as const;

export type KnownShiftCode = (typeof SHIFT_CODES)[number];

export type ShiftCode = KnownShiftCode | "unknown";

export type DayShift = {
  code: ShiftCode;
  raw: string;
};

export type MonthSchedule = {
  year: number;
  month: number;
  personName: string;
  days: Record<number, DayShift>;
  updatedAt: string;
};

export type Settings = {
  personName: string;
  accessPassword: string;
};
