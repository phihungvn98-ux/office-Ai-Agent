// Cổng 1 địa chỉ: "/" → Paperclip (giả lập), "/office/" → văn phòng pixel.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const here = path.dirname(fileURLToPath(import.meta.url));
let upstream, upPort, child, base, home;
const seen = [];
const upSockets = new Set();

const freePort = () =>
  new Promise((r) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => r(p));
    });
  });

before(async () => {
  // "Paperclip" giả: trang HTML, API JSON, SSE, upload body, WebSocket echo.
  upstream = http.createServer(async (req, res) => {
    seen.push({ url: req.url, host: req.headers.host, xfh: req.headers["x-forwarded-host"], ae: req.headers["accept-encoding"] });
    if (req.url === "/" || req.url.startsWith("/AIO")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", etag: '"abc"' });
      return res.end("<!doctype html><html><body><div id=root>Paperclip UI</div></body></html>");
    }
    if (req.url === "/api/health") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ status: "ok" }));
    }
    if (req.url === "/api/echo" && req.method === "POST") {
      let b = "";
      for await (const c of req) b += c;
      res.writeHead(201, { "content-type": "application/json", "set-cookie": "sid=1; Path=/" });
      return res.end(JSON.stringify({ got: JSON.parse(b) }));
    }
    if (req.url === "/api/sse") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: one\n\n");
      setTimeout(() => res.end("data: two\n\n"), 50);
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end('{"error":"nope"}');
  });
  upstream.on("upgrade", (req, socket) => {
    const accept = createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.on("data", (buf) => {
      // giải mã 1 frame text ngắn có mask rồi gửi lại (không mask)
      const len = buf[1] & 0x7f;
      const mask = buf.subarray(2, 6);
      const data = Buffer.from(buf.subarray(6, 6 + len).map((b, i) => b ^ mask[i % 4]));
      socket.write(Buffer.concat([Buffer.from([0x81, data.length]), data]));
    });
  });
  upstream.on("connection", (s) => {
    upSockets.add(s);
    s.on("close", () => upSockets.delete(s));
  });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  upPort = upstream.address().port;

  home = await fs.mkdtemp(path.join(os.tmpdir(), "gateway-test-"));
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [path.join(here, "..", "server.mjs")], {
    env: { ...process.env, PIXEL_OFFICE_PORT: String(port), PAPERCLIP_URL: `http://127.0.0.1:${upPort}`, AI_OFFICE_HOME: home, PIXEL_OFFICE_POLL_MS: "60000" },
    stdio: "ignore",
  });
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(base + "/office/api/state");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
});

after(async () => {
  child?.kill();
  for (const s of upSockets) s.destroy();
  upstream?.close();
  if (home) await fs.rm(home, { recursive: true, force: true });
});

test("/ serves Paperclip HTML with the office link injected", async () => {
  const res = await fetch(base + "/", { headers: { accept: "text/html" } });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Paperclip UI/);
  assert.match(html, /id="ai-office-link" href="\/office\/"/);
  assert.equal(html.match(/ai-office-link/g).length, 1);
  assert.equal(res.headers.get("etag"), null);
  assert.equal(Number(res.headers.get("content-length")), Buffer.byteLength(html));
  const last = seen.at(-1);
  assert.equal(last.ae, "identity");
  assert.equal(last.host, base.replace("http://", ""));
  assert.equal(last.xfh, base.replace("http://", ""));
});

test("deep links and API calls pass through unchanged", async () => {
  const deep = await (await fetch(base + "/AIO/issues/AIO-1", { headers: { accept: "text/html" } })).text();
  assert.match(deep, /Paperclip UI/);
  const h = await fetch(base + "/api/health");
  assert.deepEqual(await h.json(), { status: "ok" });
  const e = await fetch(base + "/api/echo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ a: 1 }) });
  assert.equal(e.status, 201);
  assert.equal(e.headers.get("set-cookie"), "sid=1; Path=/");
  assert.deepEqual(await e.json(), { got: { a: 1 } });
  const nf = await fetch(base + "/api/missing");
  assert.equal(nf.status, 404);
});

test("SSE streams through the gateway", async () => {
  const text = await (await fetch(base + "/api/sse")).text();
  assert.equal(text, "data: one\n\ndata: two\n\n");
});

test("WebSocket upgrades are proxied to Paperclip", async () => {
  const ws = new WebSocket(base.replace("http", "ws") + "/api/companies/x/events/ws");
  const msg = await new Promise((resolve, reject) => {
    ws.onopen = () => ws.send("xin chào");
    ws.onmessage = (m) => resolve(m.data);
    ws.onerror = (e) => reject(new Error(e.message || "ws error"));
    setTimeout(() => reject(new Error("timeout")), 3000);
  });
  assert.equal(msg, "xin chào");
  ws.close();
});

test("/office/ stays with Pixel Office and is not proxied", async () => {
  const before = seen.length;
  const html = await (await fetch(base + "/office/")).text();
  assert.match(html, /Pixel Office/);
  const st = await (await fetch(base + "/office/api/state")).json();
  assert.equal(st.paperclipUrl, "/");
  assert.ok(seen.slice(before).every((r) => !r.url.startsWith("/office")));
});

test("Paperclip down → Vietnamese error page (HTML) or JSON error", async () => {
  const closed = new Promise((r) => upstream.close(r));
  for (const s of upSockets) s.destroy();
  await closed;
  const page = await fetch(base + "/", { headers: { accept: "text/html" } });
  assert.equal(page.status, 502);
  assert.match(await page.text(), /Paperclip chưa chạy/);
  const api = await fetch(base + "/api/health");
  assert.equal(api.status, 502);
  assert.match((await api.json()).error, /Paperclip không phản hồi/);
  // văn phòng vẫn mở được
  assert.equal((await fetch(base + "/office/")).status, 200);
});
