import { createWorker, PSM } from "tesseract.js";
import type { Worker } from "tesseract.js";
import { daysInMonth } from "./calendar.ts";
import { extractRow, type OcrWord } from "./row.ts";
import type { MonthSchedule } from "../types.ts";

const OCR_ENDPOINT = "https://api.ocr.space/parse/image";
const OCR_KEY = "helloworld";
const MAX_BYTES = 1_000_000;
const CLARITY_EDGE = 2200;
const TARGET_EDGE = 3200;
const BLUR_LIMIT = 80;

type StatusListener = (status: string) => void;

type OcrWordBox = {
  WordText?: string;
  Left?: number;
  Top?: number;
  Height?: number;
  Width?: number;
};

type OcrLine = { Words?: OcrWordBox[] };

type ParsedPage = {
  ParsedText?: string | null;
  TextOverlay?: { Lines?: OcrLine[] } | null;
  ErrorMessage?: string | string[] | null;
  FileParseExitCode?: number | string;
};

type OcrResponse = {
  ParsedResults?: ParsedPage[];
  IsErroredOnProcessing?: boolean;
  ErrorMessage?: string | string[] | null;
  OCRExitCode?: number | string;
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

function messageText(value: unknown): string {
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string").join(" ");
  return typeof value === "string" ? value : "";
}

function quotaReached(text: string): boolean {
  return /limit|quota|maximum|too many/i.test(text);
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
  const { data, width, height } = image;
  const gray = new Uint8ClampedArray(width * height);
  for (let index = 0, pixel = 0; index < data.length; index += 4, pixel += 1) {
    const value = data[index] * 0.3 + data[index + 1] * 0.59 + data[index + 2] * 0.11;
    gray[pixel] = Math.max(0, Math.min(255, (value - 128) * 1.45 + 128));
  }
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const sharp =
        gray[index] * 5 -
        gray[index - 1] -
        gray[index + 1] -
        gray[index - width] -
        gray[index + width];
      const value = Math.max(0, Math.min(255, sharp));
      const offset = index * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
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

function collect(page: ParsedPage): { words: OcrWord[]; lines: string[] } {
  const words: OcrWord[] = [];
  const lines: string[] = [];
  for (const line of page.TextOverlay?.Lines ?? []) {
    const parts: string[] = [];
    for (const word of line.Words ?? []) {
      const text = word.WordText?.trim() ?? "";
      if (!text) continue;
      const x0 = word.Left ?? 0;
      const y0 = word.Top ?? 0;
      words.push({
        text,
        x0,
        y0,
        x1: x0 + (word.Width ?? 0),
        y1: y0 + (word.Height ?? 0),
      });
      parts.push(text);
    }
    if (parts.length > 0) lines.push(parts.join(" "));
  }
  const parsed = page.ParsedText?.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) ?? [];
  lines.push(...parsed);
  return { words, lines };
}

async function requestOcr(image: Blob): Promise<ParsedPage> {
  const body = new FormData();
  body.append("file", image, "roster.jpg");
  body.append("language", "cht");
  body.append("isOverlayRequired", "true");
  body.append("scale", "true");
  body.append("isTable", "true");
  body.append("OCREngine", "3");
  body.append("detectOrientation", "true");
  let response: Response;
  try {
    response = await fetch(OCR_ENDPOINT, {
      method: "POST",
      headers: { apikey: OCR_KEY },
      body,
    });
  } catch {
    throw new Error("沒有網路，請連線後再試");
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (response.status === 429 || quotaReached(detail)) throw new QuotaError();
    throw new Error("這張照片沒有辨識成功，請再拍清楚一點");
  }
  const payload = (await response.json()) as OcrResponse;
  const error = messageText(payload.ErrorMessage);
  if (payload.IsErroredOnProcessing || payload.OCRExitCode === 3 || payload.OCRExitCode === "3") {
    if (quotaReached(error)) throw new QuotaError();
    throw new Error(error || "這張照片沒有辨識成功，請再拍清楚一點");
  }
  const page = payload.ParsedResults?.[0];
  if (!page || page.FileParseExitCode === -10 || page.FileParseExitCode === "-10") {
    const pageError = messageText(page?.ErrorMessage);
    if (quotaReached(pageError)) throw new QuotaError();
    throw new Error("這張照片沒有辨識成功，請再拍清楚一點");
  }
  return page;
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
    throw new Error("這張照片沒有辨識成功，請再拍清楚一點");
  }
  if (!found.found) throw new Error(`找不到「${trimmedName}」這一列，請拍清楚整張班表後再試`);
  return {
    year,
    month,
    personName: trimmedName,
    days: found.days,
    updatedAt: new Date().toISOString(),
  };
}

function scheduleFrom(found: { days: MonthSchedule["days"] }, personName: string, year: number, month: number): MonthSchedule {
  return {
    year,
    month,
    personName,
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
): Promise<MonthSchedule> {
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
  onStatus("正在上傳班表…");
  try {
    const page = await requestOcr(prepared.upload);
    const { words, lines } = collect(page);
    const found = extractRow(words, trimmedName, daysInMonth(year, month), lines);
    if (!found.found) throw new Error(`找不到「${trimmedName}」這一列，請拍清楚整張班表後再試`);
    return scheduleFrom(found, trimmedName, year, month);
  } catch (error) {
    if (!(error instanceof QuotaError)) throw error;
    onStatus("免費次數已用完，改在手機裡辨識…");
    return readLocalRow(prepared.canvas, trimmedName, year, month);
  }
}
