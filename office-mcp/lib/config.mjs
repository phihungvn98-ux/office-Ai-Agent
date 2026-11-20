import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

// Nạp <repo>/.env nếu có (không ghi đè biến đã có).
const envFile = path.join(repoRoot, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const env = process.env;
const home = env.AI_OFFICE_HOME ? path.resolve(env.AI_OFFICE_HOME) : repoRoot;

export const config = {
  home,
  officeDir: path.join(home, "workspaces", "_office"),
  jobsDir: path.join(home, "workspaces", "_office", "jobs"),
  ninerouterUrl: (env.NINEROUTER_URL || "http://localhost:20128/v1").replace(/\/+$/, ""),
  ninerouterKey: env.NINEROUTER_API_KEY || "",
  defaultModel: env.NINEROUTER_DEFAULT_MODEL || "gpt-6",
  // auto = thử /responses trước, lỗi thì quay về /chat/completions · responses · chat
  ninerouterApiStyle: ["auto", "responses", "chat"].includes((env.NINEROUTER_API_STYLE || "").trim().toLowerCase())
    ? env.NINEROUTER_API_STYLE.trim().toLowerCase()
    : "auto",
  llmTimeoutMs: Number(env.NINEROUTER_TIMEOUT_MS || 120000),
  pixelOfficeUrl: (env.PIXEL_OFFICE_URL || "http://localhost:3200").replace(/\/+$/, ""),
  pixelOfficeToken: env.PIXEL_OFFICE_TOKEN || "",
  freelancerApiBase: (env.FREELANCER_API_BASE || "https://www.freelancer.com/api").replace(/\/+$/, ""),
  agentId: env.PAPERCLIP_AGENT_ID || env.OFFICE_AGENT || "",
  runId: env.PAPERCLIP_RUN_ID || "",
};
