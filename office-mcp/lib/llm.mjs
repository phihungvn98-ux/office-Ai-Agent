import { config } from "./config.mjs";

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
  if (!res.ok) throw new Error(`9Router trả ${res.status}: ${body.slice(0, 500)}`);
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`9Router trả dữ liệu không phải JSON: ${body.slice(0, 200)}`);
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

export async function askModel({ prompt, system, model, temperature, max_tokens, json }) {
  const messages = [];
  const sys = [system, json ? "Chỉ trả về JSON hợp lệ, không giải thích thêm." : null].filter(Boolean).join("\n\n");
  if (sys) messages.push({ role: "system", content: sys });
  messages.push({ role: "user", content: prompt });

  const payload = { model: model || config.defaultModel, messages };
  if (temperature !== undefined) payload.temperature = temperature;
  if (max_tokens !== undefined) payload.max_tokens = max_tokens;

  const started = Date.now();
  const data = await call("/chat/completions", { method: "POST", body: JSON.stringify(payload) });
  const content = data?.choices?.[0]?.message?.content ?? "";
  const out = {
    model: data.model || payload.model,
    elapsed_ms: Date.now() - started,
    usage: data.usage || null,
    text: content,
  };
  if (json) {
    try {
      out.json = extractJson(content);
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
