#!/usr/bin/env node
// Pixel Office — dashboard văn phòng pixel cho AI Office.
// Đọc dữ liệu từ Paperclip (REST + WebSocket live events), gộp trạng thái do agent tự báo (MCP office_status),
// phát cho trình duyệt qua SSE. Không phụ thuộc thư viện ngoài.

import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import { PaperclipClient } from "./lib/paperclip.mjs";
import { buildState } from "./lib/state.mjs";
import { DemoSource } from "./lib/demo.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

// ---- cấu hình (.env ở thư mục gốc repo, biến môi trường thắng) ----
const envFile = path.join(repoRoot, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const env = process.env;
const cfg = {
  port: Number(env.PIXEL_OFFICE_PORT || 3200),
  host: env.PIXEL_OFFICE_HOST || "127.0.0.1",
  token: env.PIXEL_OFFICE_TOKEN || "",
  user: env.PIXEL_OFFICE_USER || "",
  pass: env.PIXEL_OFFICE_PASS || "",
  pollMs: Number(env.PIXEL_OFFICE_POLL_MS || 5000),
  demo: env.PIXEL_OFFICE_DEMO === "1" || process.argv.includes("--demo"),
  home: env.AI_OFFICE_HOME ? path.resolve(env.AI_OFFICE_HOME) : repoRoot,
  paperclipUrl: (env.PAPERCLIP_URL || "http://localhost:3100").replace(/\/+$/, ""),
  paperclipPublicUrl: (env.PAPERCLIP_PUBLIC_URL || env.PAPERCLIP_URL || "http://localhost:3100").replace(/\/+$/, ""),
  paperclipKey: env.PAPERCLIP_API_KEY || "",
  companyId: env.PAPERCLIP_COMPANY_ID || "",
  companyName: env.PAPERCLIP_COMPANY_NAME || "AI Office",
};

const source = cfg.demo
  ? new DemoSource()
  : new PaperclipClient({ baseUrl: cfg.paperclipUrl, apiKey: cfg.paperclipKey, companyId: cfg.companyId, companyName: cfg.companyName });

// ---- trạng thái do agent tự báo (office_status), giữ trong RAM + file để sống sót khi restart ----
const reportsFile = path.join(cfg.home, "workspaces", "_office", ".pixel-office-reports.json");
let reports = {};
try {
  reports = JSON.parse(fs.readFileSync(reportsFile, "utf8"));
} catch {}
let saveTimer = null;
function saveReports() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fsp.writeFile(reportsFile, JSON.stringify(reports)).catch(() => {}), 500);
}

// ---- vòng cập nhật ----
let state = { ok: false, error: "Đang kết nối Paperclip…", agents: [], projects: [], activity: [], updatedAt: null };
const clients = new Set();
let refreshing = null;
let pending = false;

async function refresh() {
  if (refreshing) {
    pending = true;
    return refreshing;
  }
  refreshing = (async () => {
    try {
      const snap = await source.snapshot();
      state = buildState(snap, { reports: { ...(snap.reports || {}), ...reports }, home: cfg.home, paperclipPublicUrl: cfg.paperclipPublicUrl, demo: cfg.demo });
    } catch (err) {
      state = { ...state, ok: false, error: err.message, updatedAt: new Date().toISOString() };
    }
    broadcast();
  })();
  try {
    await refreshing;
  } finally {
    refreshing = null;
    if (pending) {
      pending = false;
      setTimeout(refresh, 300);
    }
  }
}

function broadcast() {
  const data = `event: state\ndata: ${JSON.stringify(state)}\n\n`;
  for (const res of clients) res.write(data);
}

let debounce = null;
function refreshSoon() {
  clearTimeout(debounce);
  debounce = setTimeout(refresh, 400);
}

setInterval(refresh, cfg.pollMs);
setInterval(() => {
  for (const res of clients) res.write(`: ping\n\n`);
}, 25000);
source.onLiveEvent?.(refreshSoon);

// ---- HTTP ----
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".ico": "image/x-icon" };
const publicDir = path.join(here, "public");

const safeEq = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function checkBasicAuth(req) {
  if (!cfg.user) return true;
  const h = req.headers.authorization || "";
  if (!h.startsWith("Basic ")) return false;
  const [u, ...p] = Buffer.from(h.slice(6), "base64").toString().split(":");
  return safeEq(u, cfg.user) && safeEq(p.join(":"), cfg.pass);
}

function checkToken(req) {
  if (!cfg.token) return true;
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") && safeEq(h.slice(7), cfg.token);
}

async function readBody(req) {
  let body = "";
  for await (const c of req) {
    body += c;
    if (body.length > 64 * 1024) throw new Error("Body quá lớn");
  }
  return body ? JSON.parse(body) : {};
}

function send(res, code, data) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;

  try {
    // Agent báo trạng thái: xác thực bằng token (không cần basic auth).
    if (req.method === "POST" && p === "/api/agent-status") {
      if (!checkToken(req)) return send(res, 401, { error: "Sai token" });
      const b = await readBody(req);
      const key = b.agentId || b.agent || "unknown";
      reports[key] = {
        state: String(b.state || "working"),
        message: String(b.message || "").slice(0, 200),
        progress: typeof b.progress === "number" ? b.progress : null,
        project: b.project || null,
        runId: b.runId || null,
        at: b.at || new Date().toISOString(),
      };
      saveReports();
      refreshSoon();
      return send(res, 200, { ok: true });
    }

    // n8n / Zapier / script đẩy job vào inbox (cùng token với agent-status).
    if (req.method === "POST" && p === "/api/jobs/inbox") {
      if (!checkToken(req)) return send(res, 401, { error: "Sai token" });
      const b = await readBody(req);
      const jobs = [].concat(b.jobs ?? b).filter((j) => j && typeof j === "object" && (j.title || j.url));
      if (!jobs.length) return send(res, 400, { error: "Cần ít nhất 1 job có title hoặc url" });
      const clean = jobs.slice(0, 200).map((j) => ({
        id: String(j.id || j.url || j.title).slice(0, 300),
        platform: String(j.platform || "inbox").slice(0, 40),
        title: String(j.title || "").slice(0, 300),
        url: j.url ? String(j.url).slice(0, 1000) : null,
        description: String(j.description || "").slice(0, 5000),
        budget: j.budget ? String(j.budget).slice(0, 100) : null,
        posted_at: j.posted_at || new Date().toISOString(),
      }));
      const dir = path.join(cfg.home, "workspaces", "_office", "jobs", "inbox");
      await fsp.mkdir(dir, { recursive: true });
      const file = path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
      await fsp.writeFile(file, JSON.stringify(clean, null, 2));
      return send(res, 200, { ok: true, saved: clean.length });
    }

    if (!checkBasicAuth(req)) {
      res.writeHead(401, { "www-authenticate": 'Basic realm="Pixel Office"' });
      return res.end("Cần đăng nhập");
    }

    if (req.method === "GET" && p === "/api/state") return send(res, 200, state);

    if (req.method === "GET" && p === "/api/stream") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      res.write(`retry: 3000\nevent: state\ndata: ${JSON.stringify(state)}\n\n`);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }

    // ---- điều khiển (Cài đặt) ----
    let m;
    if (req.method === "POST" && (m = p.match(/^\/api\/agents\/([\w-]+)\/(pause|resume|wake|retry)$/))) {
      const r = await source.agentAction(m[1], m[2]);
      refreshSoon();
      return send(res, 200, { ok: true, result: r });
    }
    if (req.method === "POST" && (m = p.match(/^\/api\/agents\/([\w-]+)\/heartbeat$/))) {
      const b = await readBody(req);
      const r = await source.setHeartbeat(m[1], { enabled: !!b.enabled, intervalSec: Number(b.intervalSec) || 3600 });
      refreshSoon();
      return send(res, 200, { ok: true, result: r });
    }
    if (req.method === "POST" && (m = p.match(/^\/api\/agents\/([\w-]+)\/model$/))) {
      const b = await readBody(req);
      if (!b.model || typeof b.model !== "string") return send(res, 400, { error: "Thiếu model" });
      const r = await source.setModel(m[1], b.model.trim());
      refreshSoon();
      return send(res, 200, { ok: true, result: r });
    }
    if (req.method === "POST" && (m = p.match(/^\/api\/routines\/([\w-]+)\/(run|pause|activate)$/))) {
      const r = await source.routineAction(m[1], m[2]);
      refreshSoon();
      return send(res, 200, { ok: true, result: r });
    }
    if (req.method === "POST" && p === "/api/refresh") {
      await refresh();
      return send(res, 200, { ok: true });
    }

    // ---- file tĩnh ----
    if (req.method === "GET") {
      const rel = p === "/" ? "/index.html" : p;
      const file = path.normalize(path.join(publicDir, rel));
      if (!file.startsWith(publicDir)) return send(res, 403, { error: "forbidden" });
      try {
        const data = await fsp.readFile(file);
        res.writeHead(200, { "content-type": mime[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
        return res.end(data);
      } catch {
        return send(res, 404, { error: "Không tìm thấy" });
      }
    }
    send(res, 404, { error: "Không tìm thấy" });
  } catch (err) {
    send(res, err.status || 500, { error: err.message });
  }
});

server.listen(cfg.port, cfg.host, () => {
  console.log(`Pixel Office: http://${cfg.host}:${cfg.port}  (${cfg.demo ? "DEMO" : `Paperclip ${cfg.paperclipUrl}`})`);
  refresh();
});

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { source.close?.(); server.close(); process.exit(0); });
