import { config } from "./config.mjs";

// Lỗi HTTP từ 9Router mang theo status để askModel quyết định có quay về /chat/completions hay không.
class RouterHttpError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function call(pathname, init = {}) {
  const headers = { "content-type": "application/json", ...(init.headers || {}) };
  if (config.ninerouterKey) headers.authorization = `Bearer ${config.ninerouterKey}`;
  let res;
  try {
    res = await fetch(`${config.ninerouterUrl}${pathname}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(config.llmTimeoutMs),
    });
  } catch (err) {
    throw new Error(
      `Không kết nối được 9Router tại ${config.ninerouterUrl} (${err.cause?.code || err.name}). ` +
        "Kiểm tra 9Router đang chạy và NINEROUTER_URL trong .env.",
    );
  }
  const body = await res.text();
  if (!res.ok) throw new RouterHttpError(`9Router trả ${res.status} (${pathname}): ${body.slice(0, 500)}`, res.status);
  try {
    return JSON.parse(body);
  } catch {
    throw new RouterHttpError(`9Router trả dữ liệu không phải JSON (${pathname}): ${body.slice(0, 200)}`, res.status);
  }
}

export function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.search(/[[{]/);
    const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new Error("Model không trả JSON hợp lệ");
  }
}

// ---- Responses API (/v1/responses) ----
async function viaResponses({ model, system, prompt, temperature, max_tokens }) {
  const payload = { model, input: prompt };
  if (system) payload.instructions = system;
  if (temperature !== undefined) payload.temperature = temperature;
  if (max_tokens !== undefined) payload.max_output_tokens = max_tokens;
  const data = await call("/responses", { method: "POST", body: JSON.stringify(payload) });
  if (data?.error) throw new RouterHttpError(`9Router trả lỗi (/responses): ${JSON.stringify(data.error).slice(0, 500)}`, 200);
  let text = typeof data?.output_text === "string" ? data.output_text : "";
  if (!text && Array.isArray(data?.output)) {
    text = data.output
      .filter((o) => o.type === "message")
      .flatMap((o) => o.content || [])
      .filter((c) => c.type === "output_text" && typeof c.text === "string")
      .map((c) => c.text)
      .join("");
  }
  return { model: data.model || model, usage: data.usage || null, text };
}

// ---- Chat Completions (/v1/chat/completions) ----
async function viaChat({ model, system, prompt, temperature, max_tokens }) {
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });
  const payload = { model, messages };
  if (temperature !== undefined) payload.temperature = temperature;
  if (max_tokens !== undefined) payload.max_tokens = max_tokens;
  const data = await call("/chat/completions", { method: "POST", body: JSON.stringify(payload) });
  return { model: data.model || model, usage: data.usage || null, text: data?.choices?.[0]?.message?.content ?? "" };
}

// Ở chế độ auto: model nào /responses đã hỏng thì lần sau đi thẳng /chat/completions (trong vòng đời tiến trình).
const responsesUnsupported = new Set();

export async function askModel({ prompt, system, model, temperature, max_tokens, json }) {
  const sys = [system, json ? "Chỉ trả về JSON hợp lệ, không giải thích thêm." : null].filter(Boolean).join("\n\n");
  const req = { model: model || config.defaultModel, system: sys || undefined, prompt, temperature, max_tokens };
  const style = config.ninerouterApiStyle;

  const started = Date.now();
  let result;
  let api;
  let fallback_reason;
  if (style === "chat" || (style === "auto" && responsesUnsupported.has(req.model))) {
    result = await viaChat(req);
    api = "chat";
  } else {
    try {
      result = await viaResponses(req);
      api = "responses";
    } catch (err) {
      // Chỉ quay về chat khi 9Router trả lỗi HTTP; 9Router tắt thì chat cũng hỏng, báo lỗi luôn.
      if (style !== "auto" || !(err instanceof RouterHttpError)) throw err;
      fallback_reason = err.message;
      try {
        result = await viaChat(req);
      } catch (chatErr) {
        throw new Error(`Cả /responses và /chat/completions đều lỗi.\n- ${err.message}\n- ${chatErr.message}`);
      }
      responsesUnsupported.add(req.model);
      api = "chat";
    }
  }

  const out = { model: result.model, api, elapsed_ms: Date.now() - started, usage: result.usage, text: result.text };
  if (fallback_reason) out.fallback_reason = fallback_reason;
  if (json) {
    try {
      out.json = extractJson(result.text);
    } catch (err) {
      out.json_error = err.message;
    }
  }
  return out;
}

export async function listModels() {
  const data = await call("/models");
  return (data.data || []).map((m) => m.id);
}
