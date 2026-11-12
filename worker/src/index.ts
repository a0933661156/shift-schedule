interface Env {
  OPENAI_API_KEY: string;
  GATE: string;
}

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MAX_BYTES = 9_000_000;

function cors(request: Request): Headers {
  const headers = new Headers();
  headers.set("Access-Control-Allow-Origin", request.headers.get("Origin") || "*");
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "content-type, x-schedule-password");
  headers.set("Access-Control-Max-Age", "86400");
  return headers;
}

function json(request: Request, status: number, message: string): Response {
  const headers = cors(request);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify({ error: { message } }), { status, headers });
}

function sameSecret(left: string, right: string): boolean {
  const given = left.trim();
  const expected = right.trim();
  if (!given || given.length !== expected.length) return false;
  let diff = 0;
  for (let index = 0; index < given.length; index += 1) diff |= given.charCodeAt(index) ^ expected.charCodeAt(index);
  return diff === 0;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(request) });
    if (request.method !== "POST") return json(request, 405, "只接受照片辨識請求");
    if (!env.OPENAI_API_KEY || !env.GATE) return json(request, 500, "辨識服務尚未設定完成");
    if (!sameSecret(request.headers.get("x-schedule-password") ?? "", env.GATE)) return json(request, 401, "辨識密碼不正確");

    const declared = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_BYTES) return json(request, 413, "照片太大，請改拍一張較小的 JPEG");
    const body = await request.arrayBuffer();
    if (body.byteLength > MAX_BYTES) return json(request, 413, "照片太大，請改拍一張較小的 JPEG");

    let upstream: Response;
    try {
      upstream = await fetch(OPENAI_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        },
        body,
      });
    } catch {
      return json(request, 502, "辨識服務暫時連不上 GPT");
    }

    const headers = cors(request);
    const type = upstream.headers.get("content-type");
    if (type) headers.set("Content-Type", type);
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
