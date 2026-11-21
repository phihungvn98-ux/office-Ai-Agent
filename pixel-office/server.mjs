#!/usr/bin/env node
// Pixel Office — dashboard văn phòng pixel cho AI Office, đồng thời là "cổng" duy nhất của văn phòng:
//   /          → chuyển tiếp sang Paperclip (trang chính, gồm cả WebSocket realtime)
//   /office/   → văn phòng pixel + API riêng (/office/api/...)
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
import { createProxy } from "./lib/proxy.mjs";

const OFFICE = "/office";

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
  // Link tới Paperclip hiển thị trong văn phòng: mặc định "/" vì Paperclip đi qua chính cổng này.
  paperclipLink: env.PIXEL_OFFICE_PAPERCLIP_LINK || "/",
  injectLink: env.PIXEL_OFFICE_INJECT_LINK !== "0",
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
let state = {
  ok: false,
  error: "Đang kết nối Paperclip…",
  updatedAt: null,
  company: null,
  paperclipUrl: cfg.demo ? null : cfg.paperclipLink,
  totals: { tasks: null, costs: null, pendingApprovals: 0 },
  approvals: [],
  meeting: { active: false },
  agents: [],
  projects: [],
  routines: [],
  activity: [],
};
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
      state = buildState(snap, { reports: { ...(snap.reports || {}), ...reports }, home: cfg.home, paperclipPublicUrl: cfg.paperclipLink, demo: cfg.demo });
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

async function readBody(req, max = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > max) {
      const e = new Error("Dữ liệu gửi lên quá lớn");
      e.status = 413;
      throw e;
    }
    chunks.push(c);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    const e = new Error("JSON không hợp lệ");
    e.status = 400;
    throw e;
  }
}

// ---- tin nhắn chat / phòng họp: kiểm tra trước khi chuyển lên Paperclip ----
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_CHAT_BODY = MAX_IMAGES * Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 256 * 1024;

function badRequest(message) {
  const e = new Error(message);
  e.status = 400;
  return e;
}

function parseMessage(b) {
  const text = typeof b.body === "string" ? b.body.trim() : "";
  const raw = Array.isArray(b.images) ? b.images : [];
  if (raw.length > MAX_IMAGES) throw badRequest(`Tối đa ${MAX_IMAGES} ảnh mỗi tin`);
  const images = raw.map((img, i) => {
    const type = String(img?.type || "").toLowerCase();
    if (!IMAGE_TYPES.has(type)) throw badRequest(`Ảnh ${i + 1}: chỉ nhận PNG, JPEG, WebP, GIF`);
    const data = String(img?.data || "").replace(/^data:[^;]+;base64,/, "");
    const buffer = Buffer.from(data, "base64");
    if (!buffer.length) throw badRequest(`Ảnh ${i + 1} trống`);
    if (buffer.length > MAX_IMAGE_BYTES) throw badRequest(`Ảnh ${i + 1} lớn hơn 10 MB`);
    const ext = type.split("/")[1].replace("jpeg", "jpg");
    const name = String(img?.name || `anh-${i + 1}.${ext}`).replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120) || `anh-${i + 1}.${ext}`;
    return { name, type, buffer };
  });
  if (!text && !images.length) throw badRequest("Tin nhắn trống");
  if (text.length > 20000) throw badRequest("Tin nhắn quá dài (tối đa 20.000 ký tự)");
  return { body: text || (images.length > 1 ? `(${images.length} ảnh)` : "(ảnh)"), images };
}

const ID_RE = /^[\w-]{1,80}$/;

function send(res, code, data) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

// Demo không có Paperclip → không chuyển tiếp, "/" đưa thẳng vào văn phòng.
const proxy = cfg.demo ? null : createProxy({ target: cfg.paperclipUrl, injectLink: cfg.injectLink });

function redirect(res, location) {
  res.writeHead(302, { location, "cache-control": "no-store" });
  res.end();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === OFFICE) return redirect(res, `${OFFICE}/${url.search}`);
  if (!url.pathname.startsWith(`${OFFICE}/`)) {
    if (proxy) return proxy.handle(req, res);
    return redirect(res, `${OFFICE}/`);
  }
  const p = url.pathname.slice(OFFICE.length); // luôn bắt đầu bằng "/"

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

    // Kỹ sư (scripts/dev/deploy.sh) yêu cầu tải lại cổng sau khi gộp code mới.
    // Trả lời trước, rồi thoát với mã 75 → scripts/start.mjs bật lại ngay với code mới.
    if (req.method === "POST" && p === "/api/admin/reload") {
      const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);
      if (cfg.token ? !checkToken(req) : !local) return send(res, 401, { error: "Sai token" });
      send(res, 200, { ok: true, reloading: true });
      console.log("Nhận lệnh tải lại từ Kỹ sư — khởi động lại cổng…");
      setTimeout(() => {
        source.close?.();
        server.close();
        process.exit(75);
      }, 200);
      return;
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
    // ---- trò chuyện với nhân viên (Agent Chat của Paperclip) ----
    if ((m = p.match(/^\/api\/chat\/([\w-]+)$/))) {
      if (!ID_RE.test(m[1])) return send(res, 400, { error: "Sai mã nhân viên" });
      if (!source.getChat) return send(res, 501, { error: "Nguồn dữ liệu không hỗ trợ chat" });
      const chat = await source.getChat(m[1]);
      if (req.method === "POST") {
        const msg = parseMessage(await readBody(req, MAX_CHAT_BODY));
        await source.postMessage(chat.id, msg);
        refreshSoon();
      } else if (req.method !== "GET") return send(res, 405, { error: "Không hỗ trợ" });
      return send(res, 200, { issueId: chat.id, identifier: chat.identifier || null, messages: await source.thread(chat.id) });
    }
    // ---- hội thoại trên một task (phòng họp) ----
    if ((m = p.match(/^\/api\/thread\/([\w-]+)$/))) {
      if (!ID_RE.test(m[1])) return send(res, 400, { error: "Sai mã task" });
      if (!source.thread) return send(res, 501, { error: "Nguồn dữ liệu không hỗ trợ hội thoại" });
      if (req.method === "POST") {
        const msg = parseMessage(await readBody(req, MAX_CHAT_BODY));
        await source.postMessage(m[1], msg);
        refreshSoon();
      } else if (req.method !== "GET") return send(res, 405, { error: "Không hỗ trợ" });
      return send(res, 200, { issueId: m[1], messages: await source.thread(m[1]) });
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

// WebSocket (realtime của Paperclip UI) cũng đi qua cổng.
server.on("upgrade", (req, socket, head) => {
  if (!proxy || req.url.startsWith(`${OFFICE}/`)) return socket.destroy();
  proxy.upgrade(req, socket, head);
});

server.listen(cfg.port, cfg.host, () => {
  const base = `http://${cfg.host === "0.0.0.0" ? "localhost" : cfg.host}:${cfg.port}`;
  console.log(
    cfg.demo
      ? `Pixel Office (DEMO): ${base}${OFFICE}/`
      : `AI Office: ${base}/  →  Paperclip (${cfg.paperclipUrl})  ·  văn phòng pixel: ${base}${OFFICE}/`,
  );
  refresh();
});

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { source.close?.(); server.close(); process.exit(0); });
