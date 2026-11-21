// Test tích hợp: chạy office-mcp thật qua stdio, giả lập 9Router / Freelancer / RSS / Pixel Office bằng HTTP server local.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(here, "..", "server.mjs");

let mock, base, home, client;
const received = { chat: [], responses: [], status: [] };
// Model giả lập: "chat-only" không hỗ trợ /responses; "broken-all" hỏng cả hai endpoint.
const RESPONSES_UNSUPPORTED = new Set(["chat-only", "broken-all"]);

before(async () => {
  mock = http.createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const json = (code, data) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    };
    if (req.url === "/v1/models") return json(200, { data: [{ id: "gpt-6" }, { id: "gemini-api" }] });
    if (req.url === "/v1/responses") {
      const p = JSON.parse(body);
      received.responses.push({ auth: req.headers.authorization, payload: p });
      if (RESPONSES_UNSUPPORTED.has(p.model)) {
        return json(400, { error: { code: "responses_disabled", message: "use chat completions" } });
      }
      const wantsJson = (p.instructions || "").includes("JSON");
      const text = wantsJson ? '```json\n[{"id":"a","score":80}]\n```' : `resp:${p.input}`;
      return json(200, {
        model: p.model,
        output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
        usage: { total_tokens: 9 },
      });
    }
    if (req.url === "/v1/chat/completions") {
      const p = JSON.parse(body);
      received.chat.push({ auth: req.headers.authorization, payload: p });
      if (p.model === "broken-all") return json(500, { error: { message: "upstream down" } });
      const wantsJson = p.messages.some((m) => m.role === "system" && m.content.includes("JSON"));
      const content = wantsJson ? '```json\n[{"id":"a","score":80}]\n```' : `echo:${p.messages.at(-1).content}`;
      return json(200, { model: p.model, choices: [{ message: { content } }], usage: { total_tokens: 12 } });
    }
    if (req.url.startsWith("/fl/projects/0.1/projects/active/")) {
      const q = new URL(req.url, "http://x").searchParams.get("query");
      return json(200, {
        status: "success",
        result: {
          projects: [
            {
              id: 111,
              title: `WordPress site for ${q}`,
              seo_url: "wordpress/site-111",
              description: "<p>Need a <b>WooCommerce</b> store</p>",
              budget: { minimum: 250, maximum: 750 },
              currency: { code: "USD" },
              type: "fixed",
              time_submitted: 1763540000,
              jobs: [{ name: "WordPress" }, { name: "WooCommerce" }],
              bid_stats: { bid_count: 7 },
            },
          ],
        },
      });
    }
    if (req.url === "/feed.rss") {
      res.writeHead(200, { "content-type": "application/rss+xml" });
      return res.end(`<?xml version="1.0"?><rss><channel>
        <item><title>SEO audit needed</title><link>https://ex.com/j/1</link><guid>rss-1</guid>
        <description>&lt;p&gt;Audit 50 pages&lt;/p&gt;</description><pubDate>Wed, 19 Nov 2026 08:00:00 GMT</pubDate></item>
        </channel></rss>`);
    }
    if (req.url === "/office/api/agent-status") {
      received.status.push(JSON.parse(body));
      return json(200, { ok: true });
    }
    json(404, { error: "not found" });
  });
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${mock.address().port}`;

  home = await fs.mkdtemp(path.join(os.tmpdir(), "ai-office-test-"));
  const jobs = path.join(home, "workspaces", "_office", "jobs");
  await fs.mkdir(path.join(jobs, "inbox"), { recursive: true });
  await fs.writeFile(
    path.join(jobs, "sources.json"),
    JSON.stringify({
      sources: [
        { type: "freelancer", query: "shop", limit: 5 },
        { type: "rss", name: "Test RSS", platform: "testrss", url: `${base}/feed.rss` },
        { type: "inbox" },
        { type: "rss", name: "Broken", url: `${base}/missing.rss` },
      ],
    }),
  );
  await fs.writeFile(
    path.join(jobs, "inbox", "email-1.json"),
    JSON.stringify([{ id: "upwork-9", platform: "upwork", title: "Landing page", url: "https://upwork.com/x" }]),
  );

  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [serverPath],
      env: {
        PATH: process.env.PATH,
        AI_OFFICE_HOME: home,
        NINEROUTER_URL: `${base}/v1`,
        NINEROUTER_API_KEY: "test-key",
        NINEROUTER_DEFAULT_MODEL: "gpt-6",
        FREELANCER_API_BASE: `${base}/fl`,
        PIXEL_OFFICE_URL: base,
        PAPERCLIP_AGENT_ID: "agent-123",
      },
    }),
  );
});

after(async () => {
  await client?.close();
  mock?.close();
  if (home) await fs.rm(home, { recursive: true, force: true });
});

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  return { ...r, data: (() => { try { return JSON.parse(r.content[0].text); } catch { return r.content[0].text; } })() };
};

test("lists all office tools", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["ask_model", "jobs_fetch", "jobs_mark_seen", "list_models", "office_status"]);
});

// Mở thêm một client MCP với env riêng (để thử NINEROUTER_API_STYLE khác nhau).
async function withClient(extraEnv, fn) {
  const c = new Client({ name: "t-extra", version: "0" });
  await c.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [serverPath],
      env: {
        PATH: process.env.PATH,
        AI_OFFICE_HOME: home,
        NINEROUTER_URL: `${base}/v1`,
        NINEROUTER_API_KEY: "test-key",
        NINEROUTER_DEFAULT_MODEL: "gpt-6",
        ...extraEnv,
      },
    }),
  );
  try {
    return await fn(async (args) => {
      const r = await c.callTool({ name: "ask_model", arguments: args });
      let data;
      try {
        data = JSON.parse(r.content[0].text);
      } catch {
        data = r.content[0].text;
      }
      return { ...r, data };
    });
  } finally {
    await c.close();
  }
}

test("ask_model (auto) uses /responses with key and default model", async () => {
  const chatBefore = received.chat.length;
  const r = await call("ask_model", { prompt: "xin chào" });
  assert.equal(r.isError, undefined);
  assert.equal(r.data.api, "responses");
  assert.equal(r.data.text, "resp:xin chào");
  assert.equal(r.data.model, "gpt-6");
  assert.equal(r.data.fallback_reason, undefined);
  assert.equal(received.responses.at(-1).auth, "Bearer test-key");
  assert.equal(received.responses.at(-1).payload.instructions, undefined);
  assert.equal(received.chat.length, chatBefore, "không được gọi chat khi /responses chạy tốt");
});

test("ask_model json mode parses fenced JSON via /responses", async () => {
  const r = await call("ask_model", { prompt: "chấm điểm", json: true, model: "gemini-api", max_tokens: 50 });
  assert.equal(r.data.api, "responses");
  assert.deepEqual(r.data.json, [{ id: "a", score: 80 }]);
  const p = received.responses.at(-1).payload;
  assert.equal(p.model, "gemini-api");
  assert.equal(p.max_output_tokens, 50);
  assert.match(p.instructions, /JSON/);
});

test("ask_model (auto) falls back to /chat/completions and remembers the model", async () => {
  const respBefore = received.responses.filter((x) => x.payload.model === "chat-only").length;
  const first = await call("ask_model", { prompt: "lần 1", model: "chat-only", system: "ngắn gọn" });
  assert.equal(first.isError, undefined);
  assert.equal(first.data.api, "chat");
  assert.equal(first.data.text, "echo:lần 1");
  assert.match(first.data.fallback_reason, /400/);
  const chatPayload = received.chat.at(-1).payload;
  assert.deepEqual(chatPayload.messages[0], { role: "system", content: "ngắn gọn" });

  const second = await call("ask_model", { prompt: "lần 2", model: "chat-only" });
  assert.equal(second.data.api, "chat");
  assert.equal(second.data.fallback_reason, undefined);
  const respAfter = received.responses.filter((x) => x.payload.model === "chat-only").length;
  assert.equal(respAfter - respBefore, 1, "lần 2 đi thẳng chat, không thử /responses lại");
});

test("ask_model (auto) reports both errors when both endpoints fail", async () => {
  const r = await call("ask_model", { prompt: "x", model: "broken-all" });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /Cả \/responses và \/chat\/completions đều lỗi/);
  assert.match(r.content[0].text, /400/);
  assert.match(r.content[0].text, /500/);
});

test("NINEROUTER_API_STYLE=chat only calls /chat/completions", async () => {
  const respBefore = received.responses.length;
  await withClient({ NINEROUTER_API_STYLE: "chat" }, async (ask) => {
    const r = await ask({ prompt: "chỉ chat" });
    assert.equal(r.data.api, "chat");
    assert.equal(r.data.text, "echo:chỉ chat");
    assert.equal(received.chat.at(-1).auth, "Bearer test-key");
  });
  assert.equal(received.responses.length, respBefore);
});

test("NINEROUTER_API_STYLE=responses does not fall back", async () => {
  const chatBefore = received.chat.length;
  await withClient({ NINEROUTER_API_STYLE: "Responses" }, async (ask) => {
    const ok = await ask({ prompt: "r" });
    assert.equal(ok.data.api, "responses");
    const bad = await ask({ prompt: "r", model: "chat-only" });
    assert.equal(bad.isError, true);
    assert.match(bad.content[0].text, /400 \(\/responses\)/);
  });
  assert.equal(received.chat.length, chatBefore);
});

test("list_models", async () => {
  const r = await call("list_models");
  assert.deepEqual(r.data, ["gpt-6", "gemini-api"]);
});

test("jobs_fetch merges sources, reports broken source, dedupes after mark_seen", async () => {
  const r = await call("jobs_fetch", { limit: 10 });
  const ids = r.data.jobs.map((j) => j.id).sort();
  assert.deepEqual(ids, ["freelancer:111", "testrss:rss-1", "upwork:upwork-9"]);
  const fl = r.data.jobs.find((j) => j.id === "freelancer:111");
  assert.equal(fl.title, "WordPress site for shop");
  assert.equal(fl.description, "Need a WooCommerce store");
  assert.equal(fl.budget, "250–750 USD");
  assert.equal(fl.url, "https://www.freelancer.com/projects/wordpress/site-111");
  assert.equal(r.data.errors.length, 1);
  assert.match(r.data.errors[0], /Broken/);

  await call("jobs_mark_seen", { ids: ["freelancer:111", "testrss:rss-1"] });
  const again = await call("jobs_fetch", {});
  // inbox đã chuyển sang processed/, 2 job kia đã xem → rỗng
  assert.equal(again.data.count, 0);
  const processed = await fs.readdir(path.join(home, "workspaces", "_office", "jobs", "inbox", "processed"));
  assert.deepEqual(processed, ["email-1.json"]);
});

test("office_status posts to Pixel Office with agent id", async () => {
  const r = await call("office_status", { state: "working", message: "Đang quét job", progress: 40, project: "_office" });
  assert.equal(r.data.delivered, "pixel-office");
  assert.equal(received.status.at(-1).agentId, "agent-123");
  assert.equal(received.status.at(-1).progress, 40);
});

test("ask_model reports a clear error when 9Router is down", async () => {
  const c = new Client({ name: "t2", version: "0" });
  await c.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [serverPath],
      env: { PATH: process.env.PATH, AI_OFFICE_HOME: home, NINEROUTER_URL: "http://127.0.0.1:9/v1" },
    }),
  );
  const r = await c.callTool({ name: "ask_model", arguments: { prompt: "x" } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /Không kết nối được 9Router/);
  await c.close();
});
