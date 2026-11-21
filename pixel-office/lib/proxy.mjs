// Cổng chuyển tiếp: mọi đường dẫn không thuộc /office được chuyển sang Paperclip (HTTP + WebSocket).
// Không dùng thư viện ngoài. Giữ nguyên Host như một reverse proxy thông thường, thêm X-Forwarded-*.

import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

// Nút nổi đưa từ Paperclip sang văn phòng pixel. Chỉ là thẻ <a>, không có script.
export const OFFICE_LINK_HTML =
  '<a id="ai-office-link" href="/office/" title="Mở văn phòng pixel" ' +
  'style="position:fixed;right:60px;top:12px;z-index:2147483000;display:inline-flex;align-items:center;gap:6px;' +
  "padding:8px 12px;border-radius:999px;background:#6d4fe0;color:#fff;font:600 13px/1 system-ui,sans-serif;" +
  'text-decoration:none;box-shadow:0 2px 10px rgba(0,0,0,.25)">🏢 Văn phòng</a>';

function forwardedHeaders(req, extra = {}) {
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) headers[k] = v;
  }
  const remote = req.socket?.remoteAddress || "";
  headers["x-forwarded-for"] = headers["x-forwarded-for"] ? `${headers["x-forwarded-for"]}, ${remote}` : remote;
  headers["x-forwarded-host"] ??= req.headers.host || "";
  headers["x-forwarded-proto"] ??= req.socket?.encrypted ? "https" : "http";
  return { ...headers, ...extra };
}

function errorPage(target, err) {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Paperclip chưa chạy</title>
<style>body{font:15px/1.6 system-ui,sans-serif;max-width:640px;margin:10vh auto;padding:0 16px;color:#22202a;background:#f3f1ec}
code{background:#e9e5dc;padding:2px 6px;border-radius:4px}a{color:#6d4fe0}
@media (prefers-color-scheme:dark){body{background:#15141c;color:#ecebf3}code{background:#262433}a{color:#9b85ff}}</style></head>
<body><h1>Paperclip chưa chạy</h1>
<p>Không kết nối được Paperclip tại <code>${target}</code> (${String(err?.code || err?.message || err).replace(/[<>&]/g, "")}).</p>
<p>Khởi động bằng <code>npm start</code> (bật cả Paperclip lẫn văn phòng), hoặc riêng Paperclip bằng <code>npm run paperclip</code>.
Trang sẽ hoạt động lại khi Paperclip lên.</p>
<p><a href="/office/">→ Mở văn phòng pixel</a></p></body></html>`;
}

export function createProxy({ target, injectLink = true }) {
  const t = new URL(target);
  const isHttps = t.protocol === "https:";
  const agent = isHttps ? new https.Agent({ keepAlive: true }) : new http.Agent({ keepAlive: true });
  const client = isHttps ? https : http;
  const port = Number(t.port || (isHttps ? 443 : 80));

  function handle(req, res) {
    const wantsHtml = injectLink && req.method === "GET" && /text\/html/.test(req.headers.accept || "");
    // Trang HTML cần chèn nút → xin bản không nén để sửa được.
    const extra = wantsHtml ? { "accept-encoding": "identity" } : {};
    const upstream = client.request(
      { protocol: t.protocol, hostname: t.hostname, port, method: req.method, path: req.url, headers: forwardedHeaders(req, extra), agent },
      (up) => {
        const headers = { ...up.headers };
        for (const h of HOP_BY_HOP) delete headers[h];
        const isHtml = wantsHtml && up.statusCode === 200 && /text\/html/.test(up.headers["content-type"] || "") && !up.headers["content-encoding"];
        if (!isHtml) {
          res.writeHead(up.statusCode, up.statusMessage, headers);
          up.pipe(res);
          return;
        }
        const chunks = [];
        up.on("data", (c) => chunks.push(c));
        up.on("end", () => {
          let html = Buffer.concat(chunks).toString("utf8");
          if (!html.includes('id="ai-office-link"')) {
            html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${OFFICE_LINK_HTML}</body>`) : html + OFFICE_LINK_HTML;
          }
          const body = Buffer.from(html, "utf8");
          delete headers["content-length"];
          delete headers.etag; // nội dung đã đổi
          res.writeHead(up.statusCode, up.statusMessage, { ...headers, "content-length": body.length });
          res.end(body);
        });
        up.on("error", () => res.destroy());
      },
    );
    upstream.on("error", (err) => {
      if (res.headersSent) return res.destroy();
      const html = /text\/html/.test(req.headers.accept || "");
      res.writeHead(502, { "content-type": html ? "text/html; charset=utf-8" : "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(html ? errorPage(target, err) : JSON.stringify({ error: `Paperclip không phản hồi (${err.code || err.message})` }));
    });
    req.on("aborted", () => upstream.destroy());
    req.pipe(upstream);
  }

  function upgrade(req, socket, head) {
    const connect = isHttps
      ? (cb) => tls.connect({ host: t.hostname, port, servername: t.hostname }, cb)
      : (cb) => net.connect({ host: t.hostname, port }, cb);
    const upstream = connect(() => {
      const headers = forwardedHeaders(req, { connection: "Upgrade", upgrade: req.headers.upgrade || "websocket" });
      let raw = `${req.method} ${req.url} HTTP/1.1\r\n`;
      for (const [k, v] of Object.entries(headers)) for (const val of [].concat(v)) raw += `${k}: ${val}\r\n`;
      upstream.write(raw + "\r\n");
      if (head?.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    const close = () => {
      socket.destroy();
      upstream.destroy();
    };
    upstream.on("error", close);
    socket.on("error", close);
    upstream.on("close", () => socket.destroy());
    socket.on("close", () => upstream.destroy());
  }

  return { handle, upgrade };
}
