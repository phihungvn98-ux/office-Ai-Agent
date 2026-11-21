import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.mjs";

// Gửi trạng thái tới Pixel Office. Nếu dashboard không chạy, ghi tạm ra file để không làm hỏng lượt làm việc.
export async function reportStatus({ state, message, progress, project }) {
  const payload = {
    agentId: config.agentId || null,
    runId: config.runId || null,
    state,
    message,
    progress: progress ?? null,
    project: project ?? null,
    at: new Date().toISOString(),
  };
  try {
    const headers = { "content-type": "application/json" };
    if (config.pixelOfficeToken) headers.authorization = `Bearer ${config.pixelOfficeToken}`;
    const res = await fetch(`${config.pixelOfficeUrl}/office/api/agent-status`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { ok: true, delivered: "pixel-office" };
  } catch (err) {
    const file = path.join(config.officeDir, ".status-fallback.jsonl");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, JSON.stringify(payload) + "\n");
    return { ok: true, delivered: "file", note: `Pixel Office không phản hồi (${err.message}); đã ghi ${file}` };
  }
}
