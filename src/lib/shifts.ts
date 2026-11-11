import type { DayShift, ShiftCode } from "../types.ts";

export function normalizeShift(raw: string): ShiftCode {
  const text = raw.replace(/\s+/g, "").replace(/[～~–—−]/g, "-");
  if (!text) return "unknown";
  if ((/08-12/.test(text) && /13-17/.test(text)) || text === "課") return "課";
  if (/00-0?8/.test(text) || text === "0-8") return "0-8";
  if (/16-00/.test(text) || text === "16-0") return "16-0";
  if (/08-16/.test(text) || text === "8-16") return "8-16";
  if (/例假|休假|休息日|特別休假|補休|特休/.test(text) || /^off$/i.test(text)) return "off";
  return "unknown";
}

export function coerceShift(raw: string, modelCode: string): ShiftCode {
  const fromRaw = normalizeShift(raw);
  if (fromRaw !== "unknown") return fromRaw;
  const fromModel = normalizeShift(modelCode);
  if (fromModel !== "unknown") return fromModel;
  return "unknown";
}

export function isShiftCode(value: string): value is ShiftCode {
  return value === "課" || value === "off" || value === "0-8" || value === "16-0" || value === "8-16" || value === "unknown";
}

export function shiftText(shift: DayShift | undefined): string {
  if (!shift) return "";
  if (shift.code === "unknown") return shift.raw.trim();
  return shift.code;
}

export function shiftClassName(code: ShiftCode | undefined): string {
  switch (code) {
    case "off":
      return "shift-off";
    case "0-8":
      return "shift-night";
    case "課":
      return "shift-class";
    case "16-0":
      return "shift-evening";
    case "8-16":
      return "shift-day";
    default:
      return "shift-unknown";
  }
}
