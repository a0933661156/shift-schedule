import { normalizeShift } from "./shifts.ts";
import type { DayShift } from "../types.ts";

export type OcrWord = {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

const SHIFT_PATTERN = /00-0?8|08-12|13-17|16-00|08-16|特別休假|休息日|例假|休假|補休|特休/g;

function compact(text: string): string {
  return text.replace(/\s+/g, "").replace(/[～~–—−]/g, "-");
}

function centerY(word: OcrWord): number {
  return (word.y0 + word.y1) / 2;
}

function height(word: OcrWord): number {
  return Math.max(8, word.y1 - word.y0);
}

function clusterByRow(words: OcrWord[]): OcrWord[][] {
  const sorted = [...words].sort((a, b) => centerY(a) - centerY(b) || a.x0 - b.x0);
  const rows: OcrWord[][] = [];
  for (const word of sorted) {
    const row = rows.find((items) => {
      const average = items.reduce((sum, item) => sum + centerY(item), 0) / items.length;
      const rowHeight = Math.max(...items.map(height));
      return Math.abs(centerY(word) - average) <= rowHeight * 0.65;
    });
    if (row) row.push(word);
    else rows.push([word]);
  }
  return rows;
}

export function tokenizeShifts(text: string): string[] {
  const source = compact(text);
  const tokens: string[] = [];
  for (const match of source.matchAll(SHIFT_PATTERN)) tokens.push(match[0]);
  const merged: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index] === "08-12" && tokens[index + 1] === "13-17") {
      merged.push("08-12 13-17");
      index += 1;
    } else merged.push(tokens[index]);
  }
  return merged;
}

function findNameBox(words: OcrWord[], personName: string): OcrWord | null {
  const target = compact(personName);
  if (!target) return null;
  for (const word of words) {
    if (compact(word.text).includes(target)) return word;
  }
  const pieces = words
    .map((word) => ({ ...word, token: compact(word.text) }))
    .filter((word) => word.token.length > 0 && target.includes(word.token))
    .sort((a, b) => centerY(a) - centerY(b) || a.x0 - b.x0);
  for (let start = 0; start < pieces.length; start += 1) {
    let built = "";
    let lastX = -Infinity;
    const used: OcrWord[] = [];
    for (let index = start; index < pieces.length && built.length < target.length; index += 1) {
      const piece = pieces[index];
      if (used.length > 0) {
        const sameRow = Math.abs(centerY(piece) - centerY(pieces[start])) <= Math.max(height(pieces[start]), height(piece));
        if (!sameRow || piece.x0 < lastX - 4) continue;
      }
      if (!target.startsWith(built + piece.token)) continue;
      built += piece.token;
      lastX = piece.x1;
      used.push(piece);
      if (built === target) {
        return {
          text: target,
          x0: Math.min(...used.map((item) => item.x0)),
          y0: Math.min(...used.map((item) => item.y0)),
          x1: Math.max(...used.map((item) => item.x1)),
          y1: Math.max(...used.map((item) => item.y1)),
        };
      }
    }
  }
  return null;
}

function findDateColumns(words: OcrWord[]): Map<number, number> | null {
  let best: OcrWord[] | null = null;
  let bestCount = 0;
  for (const row of clusterByRow(words)) {
    const dates = row.filter((word) => {
      const value = Number(compact(word.text));
      return Number.isInteger(value) && value >= 1 && value <= 31;
    });
    const unique = new Set(dates.map((word) => Number(compact(word.text)))).size;
    if (unique >= 15 && unique > bestCount) {
      best = dates;
      bestCount = unique;
    }
  }
  if (!best) return null;
  const columns = new Map<number, number>();
  for (const word of best) columns.set(Number(compact(word.text)), (word.x0 + word.x1) / 2);
  return columns;
}

function shiftsFromTokens(tokens: string[], dayCount: number): Record<number, DayShift> {
  const days: Record<number, DayShift> = {};
  tokens.slice(0, dayCount).forEach((raw, index) => {
    const code = normalizeShift(raw);
    if (code === "unknown") return;
    days[index + 1] = { code, raw };
  });
  return days;
}

function shiftsFromColumns(groups: Map<number, OcrWord[]>, dayCount: number): Record<number, DayShift> {
  const days: Record<number, DayShift> = {};
  for (const [day, group] of groups) {
    if (day < 1 || day > dayCount) continue;
    const raw = group
      .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
      .map((word) => word.text.trim())
      .filter((text) => text && !/^\d{1,2}$/.test(compact(text)))
      .join(" ");
    const code = normalizeShift(raw);
    if (!raw || code === "unknown") continue;
    days[day] = { code, raw };
  }
  return days;
}

function knownCount(days: Record<number, DayShift>): number {
  return Object.values(days).filter((shift) => shift.code !== "unknown").length;
}

export function extractRow(
  words: OcrWord[],
  personName: string,
  dayCount: number,
  lines: string[] = [],
): { found: boolean; days: Record<number, DayShift> } {
  const name = compact(personName);
  const nameBox = findNameBox(words, name);
  let geometric: Record<number, DayShift> = {};
  if (nameBox) {
    const nextName = words
      .filter((word) => {
        const token = compact(word.text);
        return word.y0 > nameBox.y1 + 2 && word.x0 <= nameBox.x1 && /[\u4e00-\u9fff]{2,4}/.test(token) && !token.includes(name);
      })
      .sort((a, b) => a.y0 - b.y0)[0];
    const nameHeight = height(nameBox);
    const bandTop = nameBox.y0 - nameHeight * 0.35;
    const bandBottom = nextName ? (nameBox.y1 + nextName.y0) / 2 : nameBox.y1 + nameHeight * 2.4;
    const rowWords = words.filter(
      (word) => centerY(word) >= bandTop && centerY(word) <= bandBottom && word.x0 >= nameBox.x1 - 6,
    );
    const columns = findDateColumns(words);
    if (columns) {
      const xs = [...columns.values()].sort((a, b) => a - b);
      const gaps = xs.slice(1).map((value, index) => value - xs[index]);
      const pitch = gaps.length > 0 ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 40;
      const grouped = new Map<number, OcrWord[]>();
      for (const word of rowWords) {
        const x = (word.x0 + word.x1) / 2;
        let bestDay = 0;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (const [day, columnX] of columns) {
          const distance = Math.abs(x - columnX);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestDay = day;
          }
        }
        if (bestDay > 0 && bestDistance <= pitch * 0.65) {
          const group = grouped.get(bestDay) ?? [];
          group.push(word);
          grouped.set(bestDay, group);
        }
      }
      geometric = shiftsFromColumns(grouped, dayCount);
    } else {
      const sorted = [...rowWords].sort((a, b) => a.x0 - b.x0);
      const grouped: OcrWord[][] = [];
      for (const word of sorted) {
        const current = grouped.at(-1);
        const previous = current?.at(-1);
        if (!current || !previous || word.x0 - previous.x1 > Math.max(12, height(word) * 0.45)) grouped.push([word]);
        else current.push(word);
      }
      const tokens = grouped.map((group) => group.map((word) => word.text).join(" "));
      geometric = shiftsFromTokens(tokens, dayCount);
    }
  }

  let lineDays: Record<number, DayShift> = {};
  for (const line of lines) {
    const text = compact(line);
    const at = text.indexOf(name);
    if (at < 0) continue;
    const tokens = tokenizeShifts(text.slice(at + name.length));
    if (tokens.length > knownCount(lineDays)) lineDays = shiftsFromTokens(tokens, dayCount);
  }

  if (!nameBox && knownCount(lineDays) === 0) return { found: false, days: {} };
  const days = knownCount(lineDays) > knownCount(geometric) ? lineDays : geometric;
  return { found: true, days };
}
