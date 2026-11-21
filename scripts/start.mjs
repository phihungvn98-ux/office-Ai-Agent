#!/usr/bin/env node
// npm start — bật cả văn phòng bằng 1 lệnh, 1 địa chỉ:
//   Paperclip (lõi, cổng nội bộ 3100) + Pixel Office (cổng chung 3200: "/" = Paperclip, "/office/" = văn phòng pixel)
// Tiến trình nào tắt bất ngờ sẽ tự bật lại. Ctrl+C tắt cả hai.
//   --no-paperclip   chỉ chạy văn phòng (khi Paperclip đã chạy ở nơi khác, ví dụ systemd)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const PAPERCLIP = (process.env.PAPERCLIP_URL || "http://localhost:3100").replace(/\/+$/, "");
const PORT = Number(process.env.PIXEL_OFFICE_PORT || 3200);
const color = { paperclip: "\x1b[36m", office: "\x1b[35m", reset: "\x1b[0m", b: "\x1b[1m" };
const say = (m) => console.log(`${color.b}[ai-office]${color.reset} ${m}`);

async function paperclipUp() {
  try {
    const r = await fetch(`${PAPERCLIP}/api/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

// Lần đầu trên máy mới Paperclip chưa có cấu hình → `run` (không tương tác) sẽ từ chối.
// Khi đó dùng `onboard --yes`: khởi tạo mặc định (local, không cần đăng nhập) rồi chạy luôn.
function paperclipConfigured() {
  const home = process.env.PAPERCLIP_HOME || path.join(os.homedir(), ".paperclip");
  const instance = process.env.PAPERCLIP_INSTANCE_ID || "default";
  return fs.existsSync(path.join(home, "instances", instance, "config.json"));
}

let stopping = false;
const procs = new Map();

function run(name, cmd, args) {
  const state = { name, cmd, args, child: null, backoff: 2000, startedAt: 0, fastFails: 0 };
  procs.set(name, state);
  const start = () => {
    if (stopping) return;
    state.startedAt = Date.now();
    const argv = typeof args === "function" ? args() : args;
    // detached = nhóm tiến trình riêng → khi tắt có thể tắt cả cây (Paperclip + Postgres), không để sót tiến trình mồ côi.
    const child = spawn(cmd, argv, { cwd: ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
    state.child = child;
    for (const stream of [child.stdout, child.stderr]) {
      readline.createInterface({ input: stream }).on("line", (line) => console.log(`${color[name]}[${name}]${color.reset} ${line}`));
    }
    child.on("error", (err) => say(`${name} không khởi động được: ${err.message}`));
    child.on("exit", (code, signal) => {
      state.child = null;
      if (stopping) return;
      if (Date.now() - state.startedAt > 60000) {
        state.backoff = 2000; // chạy ổn >1 phút → reset thời gian chờ
        state.fastFails = 0;
      } else state.fastFails++;
      say(`${name} đã tắt (${signal || `mã ${code}`}). Bật lại sau ${state.backoff / 1000}s…`);
      if (state.fastFails === 3) say(`${name} lỗi liên tục — đọc các dòng [${name}] ở trên để biết lý do (hoặc chạy: npm run doctor).`);
      setTimeout(start, state.backoff);
      state.backoff = Math.min(state.backoff * 2, 60000);
    });
  };
  start();
}

async function main() {
  // Gọi thẳng bản paperclipai trong node_modules (không qua npx/sh) để tín hiệu tắt tới đúng tiến trình.
  const localEntry = path.join(ROOT, "node_modules", "paperclipai", "dist", "index.js");
  const [pcCmd, pcPrefix] = fs.existsSync(localEntry)
    ? [process.execPath, [localEntry]]
    : [process.platform === "win32" ? "npx.cmd" : "npx", ["--no-install", "paperclipai"]];
  if (process.argv.includes("--no-paperclip")) {
    say("Bỏ qua Paperclip (--no-paperclip).");
  } else if (await paperclipUp()) {
    say(`Paperclip đã chạy sẵn tại ${PAPERCLIP} — dùng luôn, không bật thêm bản thứ hai.`);
  } else {
    if (!paperclipConfigured()) say("Lần đầu trên máy này: khởi tạo Paperclip (cấu hình mặc định, mất 1–2 phút)…");
    else say("Đang bật Paperclip…");
    run("paperclip", pcCmd, () => [...pcPrefix, ...(paperclipConfigured() ? ["run"] : ["onboard", "--yes", "--no-install-service"])]);
  }
  run("office", process.execPath, [path.join(ROOT, "pixel-office", "server.mjs")]);

  // Báo địa chỉ khi Paperclip sẵn sàng.
  for (let i = 0; i < 180 && !stopping; i++) {
    if (await paperclipUp()) {
      console.log(`\n${color.b}✔ AI Office đã sẵn sàng:  http://localhost:${PORT}${color.reset}`);
      console.log(`   • Paperclip (trang chính):  http://localhost:${PORT}/`);
      console.log(`   • Văn phòng pixel:          http://localhost:${PORT}/office/`);
      console.log("   Ctrl+C để tắt.\n");
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!stopping) say(`Paperclip chưa phản hồi sau 3 phút. Xem log [paperclip] ở trên, hoặc chạy: npm run doctor`);
}

function killTree(child, sig) {
  try {
    if (process.platform !== "win32") process.kill(-child.pid, sig); // cả nhóm tiến trình
    else child.kill(sig);
  } catch {
    child.kill(sig);
  }
}

async function shutdown(sig) {
  if (stopping) return;
  stopping = true;
  say(`Đang tắt (${sig})… Paperclip cần tới ~90 giây để dừng an toàn.`);
  const waits = [];
  for (const s of procs.values()) {
    if (!s.child) continue;
    waits.push(new Promise((r) => s.child.once("exit", r)));
    killTree(s.child, "SIGTERM");
  }
  const timer = setTimeout(() => {
    for (const s of procs.values()) if (s.child) killTree(s.child, "SIGKILL");
  }, 95000);
  await Promise.all(waits);
  clearTimeout(timer);
  process.exit(0);
}
process.on("SIGINT", () => shutdown("Ctrl+C"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main().catch((err) => {
  say(err.message);
  shutdown("lỗi");
});
