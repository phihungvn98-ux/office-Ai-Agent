import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildState } from "../lib/state.mjs";
import { DemoSource } from "../lib/demo.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

const agent = (o) => ({ id: o.id, name: o.id, role: "pm", status: "idle", lifecycleState: "ready", metadata: {}, adapterConfig: { model: "m" }, runtimeConfig: {}, ...o });

test("running agent on a meeting task puts everyone in the meeting", () => {
  const s = buildState({
    company: { id: "c", name: "AI Office" },
    agents: [agent({ id: "boss", role: "ceo", status: "running" }), agent({ id: "pm" }), agent({ id: "zz", status: "paused" })],
    projects: [],
    issues: [{ id: "i1", title: "Họp sáng (daily standup)", status: "in_progress", assigneeAgentId: "boss" }],
    routines: [],
    approvals: [],
    activity: [],
  });
  assert.equal(s.meeting.active, true);
  assert.deepEqual(s.meeting.participants.sort(), ["boss", "pm"]);
  assert.equal(s.agents.find((a) => a.id === "boss").activity, "meeting");
  assert.equal(s.agents.find((a) => a.id === "zz").activity, "paused");
});

test("conversational meeting: open 'Phát biểu họp' subtasks keep the meeting active on the parent issue", () => {
  const s = buildState({
    agents: [agent({ id: "boss", role: "ceo" }), agent({ id: "pm", status: "running" }), agent({ id: "eng" })],
    projects: [],
    issues: [
      { id: "m1", title: "Họp sáng (daily standup)", status: "blocked", assigneeAgentId: "boss" },
      { id: "s1", title: "Phát biểu họp standup 21/11", status: "in_progress", assigneeAgentId: "pm", parentId: "m1" },
      { id: "s2", title: "Phát biểu họp standup 21/11", status: "todo", assigneeAgentId: "eng", parentId: "m1" },
    ],
    routines: [],
    approvals: [],
    activity: [],
  });
  assert.equal(s.meeting.active, true);
  assert.equal(s.meeting.issueId, "m1");
  assert.equal(s.meeting.title, "Họp sáng (daily standup)");
  assert.equal(s.agents.find((a) => a.id === "pm").activity, "meeting");
  assert.deepEqual(s.meeting.participants.sort(), ["boss", "eng", "pm"]);
});

test("fresh agent report overrides activity and message while running", () => {
  const now = Date.now();
  const s = buildState(
    {
      agents: [agent({ id: "h", status: "running" })],
      projects: [],
      issues: [{ id: "i", title: "Quét job", status: "in_progress", assigneeAgentId: "h" }],
      routines: [],
      approvals: [],
      activity: [],
    },
    { reports: { h: { state: "researching", message: "Đang chấm 24 job", progress: 40, at: new Date(now).toISOString() } }, now },
  );
  const a = s.agents[0];
  assert.equal(a.activity, "researching");
  assert.equal(a.message, "Đang chấm 24 job");
  assert.equal(a.progress, 40);
});

test("stale report is ignored; idle agent with blocked task is waiting", () => {
  const now = Date.now();
  const s = buildState(
    {
      agents: [agent({ id: "p" })],
      projects: [{ id: "pr", name: "Shop", workspaces: [] }],
      issues: [{ id: "i", title: "Chờ khách gửi logo", status: "blocked", assigneeAgentId: "p", projectId: "pr" }],
      routines: [],
      approvals: [],
      activity: [],
    },
    { reports: { p: { state: "writing", message: "cũ", at: new Date(now - 3 * 3600e3).toISOString() } }, now },
  );
  assert.equal(s.agents[0].activity, "waiting");
  assert.match(s.agents[0].message, /Bị chặn/);
  assert.equal(s.projects[0].health, "risk");
});

test("setup error (e.g. Claude not signed in) shows as error with retry hint", () => {
  const s = buildState({
    agents: [agent({ id: "x", status: "paused", lifecycleState: "verifying", lifecycleError: "Execution configuration check failed. Authentication failed. Check the agent's AI connection." })],
    projects: [],
    issues: [],
    routines: [],
    approvals: [],
    activity: [],
  });
  assert.equal(s.agents[0].activity, "error");
  assert.ok(s.agents[0].setupError);
  assert.match(s.agents[0].message, /Chưa đăng nhập Claude Code/);
});

test("project progress uses task ratio when STATUS.md is absent", () => {
  const s = buildState({
    agents: [],
    projects: [{ id: "p", name: "P", workspaces: [] }],
    issues: ["done", "done", "todo", "in_progress"].map((st, i) => ({ id: `${i}`, title: "t", status: st, projectId: "p" })),
    routines: [],
    approvals: [],
    activity: [],
  });
  assert.equal(s.projects[0].progress, 50);
  assert.equal(s.projects[0].progressSource, "task");
});

test("demo source produces a consistent snapshot", async () => {
  const snap = await new DemoSource().snapshot();
  const s = buildState(snap, { reports: snap.reports });
  assert.equal(s.agents.length, 7);
  assert.ok(s.projects.length >= 3);
});

test("server serves page, state and accepts agent-status with token", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "pixel-office-test-"));
  const port = 3290 + Math.floor(Math.random() * 50);
  const child = spawn(process.execPath, [path.join(here, "..", "server.mjs"), "--demo"], {
    env: { ...process.env, PIXEL_OFFICE_PORT: String(port), PIXEL_OFFICE_TOKEN: "secret", AI_OFFICE_HOME: home },
    stdio: "ignore",
  });
  try {
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 50; i++) {
      try {
        await fetch(base + "/office/api/state");
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    assert.match(await (await fetch(base + "/office/")).text(), /Pixel Office/);
    // demo không có Paperclip → "/" và "/office" chuyển về /office/
    const r1 = await fetch(base + "/", { redirect: "manual" });
    assert.equal(r1.status, 302);
    assert.equal(r1.headers.get("location"), "/office/");
    const r2 = await fetch(base + "/office", { redirect: "manual" });
    assert.equal(r2.headers.get("location"), "/office/");
    const st = await (await fetch(base + "/office/api/state")).json();
    assert.equal(st.ok, true);
    const denied = await fetch(base + "/office/api/agent-status", { method: "POST", body: "{}" });
    assert.equal(denied.status, 401);
    const ok = await fetch(base + "/office/api/agent-status", {
      method: "POST",
      headers: { authorization: "Bearer secret", "content-type": "application/json" },
      body: JSON.stringify({ agentId: "test-agent", state: "working", message: "hi" }),
    });
    assert.equal(ok.status, 200);
    const inbox = await fetch(base + "/office/api/jobs/inbox", {
      method: "POST",
      headers: { authorization: "Bearer secret", "content-type": "application/json" },
      body: JSON.stringify({ jobs: [{ title: "Test job", url: "https://example.com/j/1", platform: "upwork" }, { nope: 1 }] }),
    });
    assert.deepEqual(await inbox.json(), { ok: true, saved: 1 });
    const traversal = await fetch(base + "/office/..%2f..%2fpackage.json");
    assert.notEqual(traversal.status, 200);
    const files = await fs.readdir(path.join(home, "workspaces", "_office", "jobs", "inbox"));
    assert.equal(files.length, 1);
    // reload: sai token bị chặn; đúng token → trả lời rồi thoát mã 75 (start.mjs bật lại)
    const noAuth = await fetch(base + "/office/api/admin/reload", { method: "POST" });
    assert.equal(noAuth.status, 401);
    const exited = new Promise((r) => child.once("exit", (code) => r(code)));
    const rl = await fetch(base + "/office/api/admin/reload", { method: "POST", headers: { authorization: "Bearer secret" } });
    assert.deepEqual(await rl.json(), { ok: true, reloading: true });
    assert.equal(await exited, 75);
  } finally {
    child.kill();
    await fs.rm(home, { recursive: true, force: true });
  }
});
