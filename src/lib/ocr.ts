import { createWorker, PSM } from "tesseract.js";
import type { Worker } from "tesseract.js";
import { daysInMonth } from "./calendar.ts";
import { extractRow, type OcrWord } from "./row.ts";
import { coerceShift } from "./shifts.ts";
import type { DayShift, MonthSchedule } from "../types.ts";

const VISION_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const VISION_MODELS = ["gemini-flash-latest", "gemini-3.8-flash", "gemini-3.5-flash"];
const VISION_KEY = "AQ.Ab8RN6J-3AVXdBiJyHl9owNma7eGBkhsUXaQ_j1fm0ypkMH10g";
const MAX_BYTES = 4_000_000;
const CLARITY_EDGE = 2200;
const TARGET_EDGE = 3200;
const BLUR_LIMIT = 80;

type StatusListener = (status: string) => void;

type VisionDay = {
  day?: number;
  raw?: string;
  code?: string;
};

type VisionPayload = {
  found?: boolean;
  days?: VisionDay[];
};

type VisionResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { message?: string; status?: string };
};

export type PreparedPhoto = {
  enhanced: boolean;
  canvas: HTMLCanvasElement;
  upload: Blob;
};

class QuotaError extends Error {
  constructor() {
    super("quota");
    this.name = "QuotaError";
  }
}

type VisionProblem = "timeout" | "unavailable" | "missing" | "parse" | "http";

const PROBLEM_RANK: Record<VisionProblem, number> = {
  timeout: 1,
  missing: 2,
  unavailable: 3,
  parse: 4,
  http: 5,
};

export type ReadResult = {
  schedule: MonthSchedule;
  notice: string | null;
};

function sanitizeApiText(text: string): string {
  return text
    .replace(/AQ\.[A-Za-z0-9_-]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

function apiErrorText(detail: string): string {
  try {
    const payload = JSON.parse(detail) as VisionResponse;
    return sanitizeApiText(payload.error?.message ?? "");
  } catch {
    return sanitizeApiText(detail);
  }
}

function quotaReached(status: number, detail: string): boolean {
  if (status === 429) return true;
  return /RESOURCE_EXHAUSTED|quota|rate limit|too many requests/i.test(detail);
}

function visionFailureMessage(problem: VisionProblem, status: number, detail: string): string {
  const reason = apiErrorText(detail);
  if (problem === "timeout") return "Gemini 等候超過 90 秒，沒有辨識完成。請稍後再試。";
  if (problem === "unavailable") return "Gemini 目前使用人數較多，暫時沒有辨識成功。請稍後再試。";
  if (problem === "missing") return "目前的 Gemini 模型無法使用。請稍後再試。";
  if (problem === "parse") return "Gemini 有回覆，但內容無法整理成班表。請再拍一張包含完整表格、姓名清楚的照片。";
  if (status === 401 || status === 403) {
    return reason ? `視覺辨識金鑰無法使用（${status}）。${reason}` : `視覺辨識金鑰無法使用（${status}）。`;
  }
  if (status === 400) {
    return reason ? `Gemini 無法處理這張照片（400）。${reason}` : "Gemini 無法處理這張照片（400）。請改拍一張較清楚的 JPEG。";
  }
  if (status >= 500) return `Gemini 服務暫時出錯（${status}）。請稍後再試。`;
  return reason ? `Gemini 沒有辨識成功（${status || "未知"}）。${reason}` : `Gemini 沒有辨識成功（${status || "未知"}）。`;
}

class VisionFailure extends Error {
  readonly problem: VisionProblem;

  constructor(problem: VisionProblem, status = 0, detail = "") {
    super(visionFailureMessage(problem, status, detail));
    this.name = "VisionFailure";
    this.problem = problem;
  }
}

function laplacianVariance(image: ImageData): number {
  const { data, width, height } = image;
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = (y * width + x) * 4;
      const lap =
        data[((y - 1) * width + x) * 4] +
        data[((y + 1) * width + x) * 4] +
        data[(y * width + x - 1) * 4] +
        data[(y * width + x + 1) * 4] -
        4 * data[index];
      sum += lap;
      sumSq += lap * lap;
      count += 1;
    }
  }
  if (count === 0) return 0;
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

function isUnclear(bitmap: ImageBitmap): boolean {
  const longEdge = Math.max(bitmap.width, bitmap.height);
  if (longEdge < CLARITY_EDGE) return true;
  const sampleWidth = 240;
  const scale = sampleWidth / bitmap.width;
  const canvas = document.createElement("canvas");
  canvas.width = sampleWidth;
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return true;
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = image;
  for (let index = 0; index < data.length; index += 4) {
    const gray = data[index] * 0.3 + data[index + 1] * 0.59 + data[index + 2] * 0.11;
    data[index] = gray;
    data[index + 1] = gray;
    data[index + 2] = gray;
  }
  return laplacianVariance(image) < BLUR_LIMIT;
}

function enhancePixels(image: ImageData): void {
  const { data } = image;
  const contrast = 1.2;
  for (let index = 0; index < data.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const value = data[index + channel];
      data[index + channel] = Math.max(0, Math.min(255, (value - 128) * contrast + 128));
    }
  }
}

async function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error("無法處理照片");
  return blob;
}

async function compressUpload(source: HTMLCanvasElement): Promise<Blob> {
  let canvas = source;
  let quality = 0.82;
  let blob = await canvasBlob(canvas, quality);
  while (blob.size > MAX_BYTES && quality > 0.45) {
    quality -= 0.1;
    blob = await canvasBlob(canvas, quality);
  }
  while (blob.size > MAX_BYTES && canvas.width > 800) {
    const next = document.createElement("canvas");
    next.width = Math.round(canvas.width * 0.8);
    next.height = Math.round(canvas.height * 0.8);
    const context = next.getContext("2d");
    if (!context) break;
    context.drawImage(canvas, 0, 0, next.width, next.height);
    canvas = next;
    blob = await canvasBlob(canvas, 0.72);
  }
  return blob;
}

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const bitmap = await createImageBitmap(file);
  try {
    const enhanced = isUnclear(bitmap);
    const longEdge = Math.max(bitmap.width, bitmap.height);
    const scale = enhanced ? Math.min(3, TARGET_EDGE / longEdge) : 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("無法處理照片");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (enhanced) {
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      enhancePixels(image);
      context.putImageData(image, 0, 0);
    }
    const upload =
      !enhanced && file.size <= MAX_BYTES && /jpe?g/i.test(file.type || file.name) ? file : await compressUpload(canvas);
    return { enhanced, canvas, upload };
  } finally {
    bitmap.close();
  }
}

function missingRow(personName: string): Error {
  return new Error(`找不到「${personName}」這一列，請拍清楚整張班表後再試`);
}

function visionPrompt(personName: string, year: number, month: number, dayCount: number): string {
  return [
    "你正在看一張護理師紙本班表。請同時判斷文字內容、表格格線的位置，以及每一欄對應哪一天。不要把整張照片的文字依序抄下來。",
    `目標是 ${year} 年 ${month} 月，這個月有 ${dayCount} 天。只讀姓名「${personName}」那一列。`,
    `表頭有 1 到 ${dayCount}，從左到右各佔一欄。days 必須剛好 ${dayCount} 筆，day 從 1 到 ${dayCount} 各出現一次，而且 day 必須等於該欄表頭印的數字。`,
    "先對齊表頭的日期數字，再讀這個姓名同一欄的格子。不要拿上一列或下一列的班，也不要因為旁邊格子字比較多就把內容往左或往右挪。",
    "同一格裡上下兩行仍是同一天。08-12 在上、13-17 在下是課，不可以拆成兩天，也不可以因此跳過隔壁只寫例假的窄欄。",
    "00-08 或 00~08 是 0-8，16-00 是 16-0，08-16 是 8-16。例假、休假、休息日、特別休假是 off。只寫例假的那一欄就是 off。",
    `如果看不到「${personName}」，found 設為 false，days 留空，不要填其他人的班。`,
    "raw 寫該格紙上的原文。code 只能是 課、off、0-8、16-0、8-16。",
  ].join("\n");
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("無法處理照片"));
    reader.readAsDataURL(blob);
  });
}

function parseVision(text: string): VisionPayload | null {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  if (!trimmed) return null;
  try {
    const payload = JSON.parse(trimmed) as VisionPayload;
    if (!payload || typeof payload !== "object") return null;
    return payload;
  } catch {
    return null;
  }
}

export function scheduleFromVision(payload: VisionPayload, personName: string, year: number, month: number): MonthSchedule {
  if (!payload.found) throw missingRow(personName);
  const dayCount = daysInMonth(year, month);
  const days: Record<number, DayShift> = {};
  for (const item of payload.days ?? []) {
    const day = Number(item.day);
    if (!Number.isInteger(day) || day < 1 || day > dayCount || days[day]) continue;
    const raw = typeof item.raw === "string" ? item.raw.trim() : "";
    const modelCode = typeof item.code === "string" ? item.code.trim() : "";
    const code = coerceShift(raw, modelCode);
    if (code === "unknown" && !raw && !modelCode) continue;
    days[day] = { code, raw: raw || modelCode };
  }
  if (!Object.values(days).some((shift) => shift.code !== "unknown")) throw missingRow(personName);
  return {
    year,
    month,
    personName,
    days,
    updatedAt: new Date().toISOString(),
  };
}

async function requestVision(image: Blob, personName: string, year: number, month: number, dayCount: number): Promise<VisionPayload> {
  if (!VISION_KEY) throw new Error("視覺辨識金鑰尚未設定");
  const data = await blobToBase64(image);
  const body = JSON.stringify({
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: image.type || "image/jpeg", data } },
          { text: visionPrompt(personName, year, month, dayCount) },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      thinkingConfig: { thinkingBudget: 0 },
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          found: { type: "BOOLEAN" },
          days: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                day: { type: "INTEGER" },
                raw: { type: "STRING" },
                code: { type: "STRING" },
              },
              required: ["day", "raw", "code"],
            },
          },
        },
        required: ["found", "days"],
      },
    },
  });
  let worst: VisionFailure | null = null;
  const remember = (problem: VisionProblem, status = 0, detail = "") => {
    const next = new VisionFailure(problem, status, detail);
    if (!worst || PROBLEM_RANK[next.problem] >= PROBLEM_RANK[worst.problem]) worst = next;
  };
  for (const model of VISION_MODELS) {
    let response: Response;
    try {
      response = await fetch(`${VISION_ENDPOINT}/${model}:generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": VISION_KEY,
        },
        body,
        signal: AbortSignal.timeout(90_000),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        remember("timeout");
        continue;
      }
      throw new Error("沒有網路，無法連上 Gemini。請連線後再試。");
    }
    const detail = await response.text();
    if (response.status === 404) {
      remember("missing", response.status, detail);
      continue;
    }
    if (response.status === 503) {
      remember("unavailable", response.status, detail);
      continue;
    }
    if (quotaReached(response.status, detail)) throw new QuotaError();
    if (response.status === 401 || response.status === 403) throw new VisionFailure("http", response.status, detail);
    if (!response.ok) {
      remember("http", response.status, detail);
      continue;
    }
    let payload: VisionResponse;
    try {
      payload = JSON.parse(detail) as VisionResponse;
    } catch {
      remember("parse");
      continue;
    }
    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    const parsed = parseVision(text);
    if (!parsed) {
      remember("parse");
      continue;
    }
    return parsed;
  }
  throw worst ?? new VisionFailure("http");
}

let workerPromise: Promise<Worker> | null = null;

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker("chi_tra+eng").catch((error: unknown) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

type RawBox = { x0?: number; y0?: number; x1?: number; y1?: number };
type RawWord = { text?: string; confidence?: number; bbox?: RawBox };
type RawLine = { text?: string; words?: RawWord[] };
type RawParagraph = { lines?: RawLine[] };
type RawBlock = { paragraphs?: RawParagraph[] };

function collectLocal(blocks: RawBlock[] | null): { words: OcrWord[]; lines: string[] } {
  const words: OcrWord[] = [];
  const lines: string[] = [];
  for (const block of blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        if (line.text?.trim()) lines.push(line.text);
        for (const word of line.words ?? []) {
          const text = word.text?.trim() ?? "";
          const box = word.bbox;
          if (!text || !box || box.x0 == null || box.y0 == null || box.x1 == null || box.y1 == null) continue;
          if ((word.confidence ?? 100) < 25) continue;
          words.push({ text, x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 });
        }
      }
    }
  }
  return { words, lines };
}

export async function readLocalRow(
  canvas: HTMLCanvasElement,
  personName: string,
  year: number,
  month: number,
): Promise<MonthSchedule> {
  const trimmedName = personName.trim() || "常怡然";
  let worker: Worker;
  try {
    worker = await getWorker();
  } catch {
    throw new Error("無法準備文字辨識，請確認網路後再試");
  }
  const dayCount = daysInMonth(year, month);
  let found = extractRow([], trimmedName, dayCount);
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: "1" });
    const sparse = await worker.recognize(canvas, {}, { text: true, blocks: true });
    const sparseCollected = collectLocal(sparse.data.blocks);
    found = extractRow(sparseCollected.words, trimmedName, dayCount, sparseCollected.lines);
    if (!found.found) {
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: "1" });
      const block = await worker.recognize(canvas, {}, { text: true, blocks: true });
      const blockCollected = collectLocal(block.data.blocks);
      found = extractRow(blockCollected.words, trimmedName, dayCount, [...sparseCollected.lines, ...blockCollected.lines]);
    }
  } catch {
    throw new Error("這台裝置上的文字辨識沒有讀出表格");
  }
  if (!found.found) throw new Error(`找不到「${trimmedName}」這一列`);
  return {
    year,
    month,
    personName: trimmedName,
    days: found.days,
    updatedAt: new Date().toISOString(),
  };
}

export async function readPersonRow(
  file: File,
  personName: string,
  year: number,
  month: number,
  onStatus: StatusListener = () => undefined,
): Promise<ReadResult> {
  const trimmedName = personName.trim() || "常怡然";
  let prepared: PreparedPhoto;
  try {
    const bitmap = await createImageBitmap(file);
    const unclear = isUnclear(bitmap);
    bitmap.close();
    if (unclear) onStatus("正在增強照片…");
    prepared = await preparePhoto(file);
  } catch {
    throw new Error("無法讀取這張照片");
  }
  onStatus("正在上傳給 Gemini 辨識…");
  try {
    const payload = await requestVision(prepared.upload, trimmedName, year, month, daysInMonth(year, month));
    return { schedule: scheduleFromVision(payload, trimmedName, year, month), notice: null };
  } catch (error) {
    if (!(error instanceof QuotaError)) throw error;
    onStatus("免費視覺辨識次數已用完，改在這台裝置上辨識…");
    try {
      const schedule = await readLocalRow(prepared.canvas, trimmedName, year, month);
      return { schedule, notice: "免費視覺辨識次數已用完，這次改由這台裝置辨識。請再核對班表。" };
    } catch (localError) {
      const reason = localError instanceof Error ? localError.message : "沒有辨識成功";
      throw new Error(`免費視覺辨識次數已用完。改在這台裝置上辨識也失敗：${reason}`);
    }
  }
}
