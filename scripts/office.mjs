#!/usr/bin/env node
// AI Office CLI
//   node scripts/office.mjs bootstrap            Import văn phòng vào Paperclip + gán workspace/MCP cho nhân viên
//   node scripts/office.mjs new-project <slug> --name "Tên dự án" [--client "Khách"] [--deadline 2026-12-20]
//   node scripts/office.mjs sync                 Thêm nhân viên/skill/lịch mới từ company/ vào văn phòng đang chạy
//   node scripts/office.mjs status               Tóm tắt nhân viên & dự án
//   node scripts/office.mjs doctor               Kiểm tra Paperclip, Claude CLI, 9Router, Pixel Office

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WS = path.join(ROOT, "workspaces");
const COMPANY_DIR = path.join(ROOT, "company");
const MCP_SERVER = path.join(ROOT, "office-mcp", "server.mjs");
const MCP_CONFIG = path.join(ROOT, "office-mcp", "mcp.generated.json");

// ---------- env ----------
const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const PAPERCLIP = (process.env.PAPERCLIP_URL || "http://localhost:3100").replace(/\/+$/, "");
const PAPERCLIP_KEY = process.env.PAPERCLIP_API_KEY || "";
const COMPANY_NAME = process.env.PAPERCLIP_COMPANY_NAME || "AI Office";
const PIXEL = (process.env.PIXEL_OFFICE_URL || `http://localhost:${process.env.PIXEL_OFFICE_PORT || 3200}`).replace(/\/+$/, "");

// ---------- tiện ích ----------
const c = { g: (s) => `\x1b[32m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m`, d: (s) => `\x1b[2m${s}\x1b[0m` };
const ok = (m) => console.log(`${c.g("✔")} ${m}`);
const warn = (m) => console.log(`${c.y("!")} ${m}`);
const bad = (m) => console.log(`${c.r("✘")} ${m}`);

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      out[k] = v;
    } else out._.push(a);
  }
  return out;
}

async function api(p, init = {}) {
  const headers = { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}) };
  if (PAPERCLIP_KEY) headers.authorization = `Bearer ${PAPERCLIP_KEY}`;
  const res = await fetch(`${PAPERCLIP}/api${p}`, { ...init, headers, signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(`${init.method || "GET"} ${p} → ${res.status}: ${data?.error || String(text).slice(0, 200)}`);
  return data;
}

async function paperclipUp() {
  try {
    const h = await api("/health");
    return h;
  } catch {
    return null;
  }
}

async function findCompany() {
  const list = await api("/companies");
  return list.find((x) => x.name === COMPANY_NAME) || null;
}

const slugOf = (a) => a.metadata?.officeSlug || a.urlKey;

function runPaperclipCli(cliArgs) {
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  // Ưu tiên bản paperclipai cài trong repo (đã pin version), không có thì tải bản mới nhất.
  const local = fs.existsSync(path.join(ROOT, "node_modules", "paperclipai"));
  const r = spawnSync(npx, ["--yes", local ? "paperclipai" : "paperclipai@latest", ...cliArgs, "--api-base", PAPERCLIP, ...(PAPERCLIP_KEY ? ["--api-key", PAPERCLIP_KEY] : [])], {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: { ...process.env, ...(PAPERCLIP_KEY ? { PAPERCLIP_API_KEY: PAPERCLIP_KEY } : {}) },
  });
  if (r.status !== 0) throw new Error(`paperclipai ${cliArgs.join(" ")} thất bại:\n${(r.stderr || r.stdout || "").slice(-2000)}`);
  return r.stdout;
}

function writeMcpConfig() {
  const cfg = {
    mcpServers: {
      office: {
        command: process.execPath,
        args: [MCP_SERVER],
        env: { AI_OFFICE_HOME: ROOT, PIXEL_OFFICE_URL: PIXEL },
      },
    },
  };
  fs.writeFileSync(MCP_CONFIG, JSON.stringify(cfg, null, 2) + "\n");
  return MCP_CONFIG;
}

async function ensureProjectWorkspace(project, cwd, name) {
  const full = await api(`/projects/${project.id}`);
  const list = full.workspaces || [];
  const hit = list.find((w) => path.resolve(w.cwd || "") === path.resolve(cwd));
  if (hit) return { created: false, ws: hit };
  const ws = await api(`/projects/${project.id}/workspaces`, {
    method: "POST",
    body: JSON.stringify({ name, cwd, isPrimary: list.length === 0 || !list.some((w) => w.isPrimary) }),
  });
  return { created: true, ws };
}

function readProjectName(dir) {
  try {
    const m = fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf8").match(/^#\s*Dự án:\s*(.+)$/m);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

function clientDirs() {
  if (!fs.existsSync(WS)) return [];
  return fs
    .readdirSync(WS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_") && !d.name.startsWith("."))
    .map((d) => d.name);
}

// ---------- lệnh ----------
async function bootstrap(opts) {
  console.log(c.b("\nAI Office — bootstrap\n"));
  const health = await paperclipUp();
  if (!health) {
    bad(`Không kết nối được Paperclip tại ${PAPERCLIP}.`);
    console.log(`   Khởi động Paperclip trước:  ${c.b("npx paperclipai@latest onboard --yes")}  (lần đầu)  hoặc  ${c.b("npx paperclipai run")}`);
    process.exit(1);
  }
  ok(`Paperclip ${health.version} (${health.deploymentMode}) tại ${PAPERCLIP}`);

  // 1. company
  let company = await findCompany();
  if (!company) {
    console.log("  Đang import văn phòng (company/) vào Paperclip…");
    runPaperclipCli(["company", "import", COMPANY_DIR, "--target", "new", "--yes", "--json"]);
    company = await findCompany();
    if (!company) throw new Error(`Import xong nhưng không thấy company "${COMPANY_NAME}"`);
    ok(`Đã tạo company "${company.name}"`);
  } else ok(`Company "${company.name}" đã có (${company.id})`);

  // 2. MCP config + workspace cho từng nhân viên
  const mcp = writeMcpConfig();
  ok(`MCP config: ${path.relative(ROOT, mcp)}`);
  const officeCwd = path.join(WS, "_office");
  const agents = await api(`/companies/${company.id}/agents`);
  for (const a of agents.filter((x) => x.status !== "terminated")) {
    if (a.adapterType !== "claude_local") {
      warn(`${a.name}: adapter ${a.adapterType} — bỏ qua (chỉ cấu hình tự động cho claude_local)`);
      continue;
    }
    const cfg = { ...(a.adapterConfig || {}) };
    const extra = (cfg.extraArgs || []).filter((x, i, arr) => x !== "--mcp-config" && arr[i - 1] !== "--mcp-config");
    // Kỹ sư văn phòng làm việc trên chính repo (sửa code qua worktree riêng); các nhân viên khác ở workspaces/_office.
    const isEngineer = slugOf(a) === "engineer";
    cfg.cwd = isEngineer ? ROOT : officeCwd;
    // Paperclip mặc định chạy Claude qua engine ACP, và ACP bỏ qua extraArgs → MCP "office" không được nạp.
    // Engine "cli" gọi thẳng `claude` và truyền extraArgs (--mcp-config).
    cfg.engine = "cli";
    cfg.extraArgs = [...extra, "--mcp-config", mcp];
    await api(`/agents/${a.id}`, { method: "PATCH", body: JSON.stringify({ adapterConfig: cfg }) });
    ok(`${a.name} (${slugOf(a)}): cwd=${isEngineer ? "<gốc repo>" : "workspaces/_office"}, MCP office`);
  }

  // 3. dự án nội bộ + dự án khách hàng
  const projects = await api(`/companies/${company.id}/projects`);
  const officeProject = projects.find((p) => p.name === "Vận hành văn phòng");
  if (officeProject) {
    const r = await ensureProjectWorkspace(officeProject, officeCwd, "_office");
    ok(`Dự án "Vận hành văn phòng" → workspaces/_office ${r.created ? "(mới gán)" : ""}`);
  }
  // Dự án "Phát triển văn phòng" của Kỹ sư: workspace = gốc repo. Văn phòng cũ (trước khi có Kỹ sư) chưa có → tạo.
  const engineer = (await api(`/companies/${company.id}/agents`)).find((a) => slugOf(a) === "engineer" && a.status !== "terminated");
  if (engineer) {
    let devProject = projects.find((p) => p.name === "Phát triển văn phòng");
    if (!devProject) {
      devProject = await api(`/companies/${company.id}/projects`, {
        method: "POST",
        body: JSON.stringify({
          name: "Phát triển văn phòng",
          description: "Sửa lỗi và mở rộng chính hệ thống AI Office. Mọi thay đổi làm trên nhánh riêng và chờ chủ văn phòng duyệt.",
          status: "in_progress",
          leadAgentId: engineer.id,
          color: "#3a86ff",
        }),
      });
      ok('Tạo dự án "Phát triển văn phòng"');
    }
    const r = await ensureProjectWorkspace(devProject, ROOT, "ai-office");
    ok(`Dự án "Phát triển văn phòng" → gốc repo ${r.created ? "(mới gán)" : ""}`);
  }
  for (const dir of clientDirs()) await linkClientProject(company, dir, projects);

  // 4. bật nhân viên
  if (!opts["no-activate"]) {
    for (const a of await api(`/companies/${company.id}/agents`)) {
      if (a.status !== "paused") continue;
      try {
        if (a.lifecycleState && a.lifecycleState !== "ready") await api(`/agents/${a.id}/lifecycle/retry`, { method: "POST", body: "{}" }).catch(() => {});
        await api(`/agents/${a.id}/resume`, { method: "POST", body: "{}" });
        ok(`Đã bật ${a.name}`);
      } catch (err) {
        warn(`${a.name} chưa bật được: ${err.message.split(": ").slice(-1)[0]}`);
        if (/verif|prepar|Authentication/i.test(err.message + (a.lifecycleError || ""))) {
          console.log(`   → Paperclip đang kiểm tra Claude Code CLI. Nếu chưa đăng nhập: chạy ${c.b("claude")} → /login (tài khoản Pro/Max),`);
          console.log(`     rồi chạy lại bootstrap hoặc bấm "Thử lại xác minh" trong Pixel Office › Cài đặt.`);
        }
      }
    }
  }

  console.log(`\n${c.b("Xong.")} Tiếp theo:`);
  console.log(`  • Chạy văn phòng:   ${c.b("npm start")}  (nếu chưa chạy)`);
  console.log(`  • Mở Paperclip:     ${PIXEL}/`);
  console.log(`  • Mở văn phòng pixel: ${PIXEL}/office/`);
  console.log(`  • Điền hồ sơ năng lực: workspaces/_office/profile.md và jobs/criteria.md`);
  console.log(`  • Thêm dự án khách: ${c.b('node scripts/office.mjs new-project shop-abc --name "Website Shop ABC"')}\n`);
}

async function linkClientProject(company, dir, projects) {
  const cwd = path.join(WS, dir);
  const name = readProjectName(cwd) || dir;
  let project = projects.find((p) => p.name === name);
  if (!project) {
    const agents = await api(`/companies/${company.id}/agents`);
    const pm = agents.find((a) => slugOf(a) === "pm" || a.role === "pm");
    project = await api(`/companies/${company.id}/projects`, {
      method: "POST",
      body: JSON.stringify({ name, description: `Dự án khách hàng. Workspace: workspaces/${dir}`, status: "in_progress", ...(pm ? { leadAgentId: pm.id } : {}) }),
    });
    ok(`Tạo dự án "${name}" trên Paperclip`);
  }
  const r = await ensureProjectWorkspace(project, cwd, dir);
  ok(`Dự án "${name}" → workspaces/${dir} ${r.created ? "(mới gán)" : ""}`);
  return project;
}

async function newProject(opts) {
  const slug = opts._[1];
  if (!slug || !/^[a-z0-9][a-z0-9-]{1,60}$/.test(slug)) {
    bad('Cần slug hợp lệ (chữ thường, số, gạch ngang). Ví dụ: new-project shop-abc --name "Website Shop ABC"');
    process.exit(1);
  }
  const name = typeof opts.name === "string" ? opts.name : slug;
  const dest = path.join(WS, slug);
  if (fs.existsSync(dest)) {
    warn(`workspaces/${slug} đã tồn tại — chỉ liên kết với Paperclip`);
  } else {
    await fsp.cp(path.join(WS, "_template"), dest, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    for (const f of ["CLAUDE.md", "STATUS.md", "DECISIONS.md"]) {
      const p = path.join(dest, f);
      let t = await fsp.readFile(p, "utf8");
      t = t.replaceAll("{{NAME}}", name).replaceAll("{{DATE}}", date);
      if (f === "CLAUDE.md" && typeof opts.client === "string") t = t.replace("- Tên / công ty: ", `- Tên / công ty: ${opts.client}`);
      if (f === "CLAUDE.md" && typeof opts.deadline === "string") t = t.replace("|  |  |  |", `| Bàn giao |  ${opts.deadline} |  |`);
      await fsp.writeFile(p, t);
    }
    ok(`Tạo workspaces/${slug}/ từ mẫu`);
  }

  if (!(await paperclipUp())) {
    warn(`Paperclip chưa chạy — đã tạo thư mục. Chạy lại lệnh này hoặc bootstrap sau khi bật Paperclip.`);
    return;
  }
  const company = await findCompany();
  if (!company) throw new Error("Chưa có company — chạy bootstrap trước");
  const projects = await api(`/companies/${company.id}/projects`);
  const project = await linkClientProject(company, slug, projects);

  const agents = await api(`/companies/${company.id}/agents`);
  const pm = agents.find((a) => slugOf(a) === "pm" || a.role === "pm");
  const existing = await api(`/companies/${company.id}/issues?projectId=${project.id}&limit=5`).catch(() => []);
  if (pm && (!Array.isArray(existing) || existing.length === 0)) {
    const issue = await api(`/companies/${company.id}/issues`, {
      method: "POST",
      body: JSON.stringify({
        title: `Khởi tạo dự án: ${name}`,
        description:
          `Dự án mới, workspace \`workspaces/${slug}/\`.\n\n` +
          "1. Đọc CLAUDE.md (bối cảnh do chủ văn phòng điền). Phần nào còn trống → liệt kê câu hỏi và tạo `request_confirmation`.\n" +
          "2. Chia mục tiêu/mốc thành task con trong project này (mỗi task có tiêu chí xong việc và hạn).\n" +
          "3. Viết STATUS.md đầu tiên theo mẫu trong skill office-context.",
        projectId: project.id,
        assigneeAgentId: pm.id,
        status: "todo",
        priority: "high",
      }),
    });
    ok(`Giao task ${issue.identifier} "Khởi tạo dự án" cho ${pm.name}`);
  }
  console.log(`\n→ Điền thông tin khách hàng vào ${c.b(`workspaces/${slug}/CLAUDE.md`)} để PM làm việc chính xác hơn.\n`);
}

function packageAgents() {
  const dir = path.join(COMPANY_DIR, "agents");
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, "AGENTS.md")))
    .map((d) => {
      const fm = (fs.readFileSync(path.join(dir, d.name, "AGENTS.md"), "utf8").match(/^---\n([\s\S]*?)\n---/) || [])[1] || "";
      const get = (k) => (fm.match(new RegExp(`^${k}:\\s*([\\w-]+)\\s*$`, "m")) || [])[1] || null;
      return { slug: get("slug") || d.name, reportsTo: get("reportsTo") };
    });
}
const packageAgentSlugs = () => packageAgents().map((a) => a.slug);

async function sync(opts) {
  if (!(await paperclipUp())) return bad(`Paperclip không chạy (${PAPERCLIP})`);
  const company = await findCompany();
  if (!company) return bootstrap(opts);
  // Paperclip so trùng theo urlKey (sinh từ tên tiếng Việt), không theo slug → tự lọc nhân viên mới theo metadata.officeSlug.
  const existing = new Set((await api(`/companies/${company.id}/agents`)).filter((a) => a.status !== "terminated").map(slugOf));
  const fresh = packageAgentSlugs().filter((s) => !existing.has(s));
  if (!fresh.length) ok("Không có nhân viên mới trong company/agents");
  else {
    console.log(`  Tuyển nhân viên mới: ${fresh.join(", ")}`);
    runPaperclipCli(["company", "import", COMPANY_DIR, "--target", "existing", "--company-id", company.id, "--include", "agents,skills", "--agents", fresh.join(","), "--collision", "skip", "--yes", "--json"]);
    ok("Đã import nhân viên mới (kèm skill)");
    // Import riêng nhân viên mới thì Paperclip không nối được cấp trên đã có sẵn → tự nối theo reportsTo trong AGENTS.md.
    const live = (await api(`/companies/${company.id}/agents`)).filter((a) => a.status !== "terminated");
    for (const pkg of packageAgents().filter((p) => fresh.includes(p.slug) && p.reportsTo && p.reportsTo !== "null")) {
      const me = live.find((a) => slugOf(a) === pkg.slug);
      const boss = live.find((a) => slugOf(a) === pkg.reportsTo);
      if (me && boss && !me.reportsTo) {
        await api(`/agents/${me.id}`, { method: "PATCH", body: JSON.stringify({ reportsTo: boss.id }) });
        ok(`${me.name} báo cáo cho ${boss.name}`);
      }
    }
  }
  console.log(c.d("  Lịch định kỳ mới: tạo trong Paperclip › Routines (sync không tự tạo để tránh trùng lịch)."));
  return bootstrap(opts);
}

async function status() {
  if (!(await paperclipUp())) return bad(`Paperclip không chạy (${PAPERCLIP})`);
  const company = await findCompany();
  if (!company) return warn("Chưa có company — chạy bootstrap");
  const [agents, projects, issues] = await Promise.all([
    api(`/companies/${company.id}/agents`),
    api(`/companies/${company.id}/projects`),
    api(`/companies/${company.id}/issues?status=backlog,todo,in_progress,in_review,blocked,done&limit=500`),
  ]);
  console.log(c.b(`\n${company.name}\n`));
  console.log(c.b("Nhân viên"));
  for (const a of agents) {
    const cur = issues.find((i) => i.assigneeAgentId === a.id && i.status === "in_progress");
    console.log(`  ${a.name.padEnd(18)} ${a.status.padEnd(9)} ${c.d(a.adapterConfig?.model || "")} ${cur ? `→ ${cur.identifier} ${cur.title}` : ""}`);
  }
  console.log(c.b("\nDự án"));
  for (const p of projects) {
    const mine = issues.filter((i) => i.projectId === p.id);
    const done = mine.filter((i) => i.status === "done").length;
    const blocked = mine.filter((i) => i.status === "blocked").length;
    const pct = mine.length ? Math.round((done / mine.length) * 100) : 0;
    const barLen = 20;
    const bar = "█".repeat(Math.round((pct / 100) * barLen)).padEnd(barLen, "░");
    console.log(`  ${p.name.padEnd(28)} ${bar} ${String(pct).padStart(3)}%  ${done}/${mine.length}${blocked ? c.r(`  ${blocked} bị chặn`) : ""}`);
  }
  console.log();
}

async function doctor() {
  console.log(c.b("\nAI Office — kiểm tra\n"));
  const major = Number(process.versions.node.split(".")[0]);
  major >= 24 ? ok(`Node ${process.versions.node}`) : warn(`Node ${process.versions.node} — Paperclip cần Node ≥ 24.11 (Pixel Office/MCP chạy được từ Node 22)`);

  const claude = spawnSync(process.platform === "win32" ? "claude.cmd" : "claude", ["--version"], { encoding: "utf8", shell: process.platform === "win32" });
  claude.status === 0 ? ok(`Claude Code ${claude.stdout.trim()}`) : bad("Chưa cài Claude Code CLI: npm i -g @anthropic-ai/claude-code, rồi chạy `claude` và /login bằng tài khoản Pro/Max");

  const h = await paperclipUp();
  h ? ok(`Paperclip ${h.version} tại ${PAPERCLIP}`) : bad(`Paperclip không chạy tại ${PAPERCLIP}`);
  if (h) {
    const company = await findCompany().catch(() => null);
    if (!company) warn("Chưa import văn phòng — chạy bootstrap");
    else {
      const agents = await api(`/companies/${company.id}/agents`);
      for (const a of agents) {
        if (a.lifecycleError) warn(`${a.name}: ${a.lifecycleError.split(". ").slice(0, 2).join(". ")}`);
        else ok(`${a.name}: ${a.status}`);
      }
    }
  }

  const nr = (process.env.NINEROUTER_URL || "http://localhost:20128/v1").replace(/\/+$/, "");
  try {
    const res = await fetch(`${nr}/models`, {
      headers: process.env.NINEROUTER_API_KEY ? { authorization: `Bearer ${process.env.NINEROUTER_API_KEY}` } : {},
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const models = ((await res.json()).data || []).map((m) => m.id);
    ok(`9Router ${nr}: ${models.length} model${models.length ? ` (${models.slice(0, 6).join(", ")}${models.length > 6 ? ", …" : ""})` : ""}`);
    const def = process.env.NINEROUTER_DEFAULT_MODEL || "gpt-6";
    if (models.length && !models.includes(def)) warn(`Model mặc định "${def}" không có trong 9Router — sửa NINEROUTER_DEFAULT_MODEL trong .env`);
  } catch (err) {
    warn(`9Router không phản hồi tại ${nr} (${err.message}). Agent vẫn chạy được bằng Claude; ask_model sẽ báo lỗi.`);
  }

  try {
    const r = await fetch(`${PIXEL}/office/api/state`, { signal: AbortSignal.timeout(3000) });
    r.ok ? ok(`Cổng chung ${PIXEL}/ (Paperclip) · ${PIXEL}/office/ (văn phòng)`) : warn(`Pixel Office trả ${r.status}`);
  } catch {
    warn(`Cổng chung ${PIXEL} chưa chạy (npm start)`);
  }
  fs.existsSync(MCP_CONFIG) ? ok("MCP config đã tạo") : warn("Chưa có office-mcp/mcp.generated.json — chạy bootstrap");
  fs.existsSync(path.join(WS, "_office", "jobs", "sources.json")) ? ok("Nguồn job: jobs/sources.json") : warn("Chưa có workspaces/_office/jobs/sources.json");
  console.log();
}

// ---------- main ----------
const opts = args(process.argv.slice(2));
const cmd = opts._[0];
const commands = { bootstrap, sync, "new-project": newProject, status, doctor };
if (!commands[cmd]) {
  console.log(`Dùng: node scripts/office.mjs <lệnh>

  bootstrap [--no-activate]                     Import văn phòng vào Paperclip, gán workspace + MCP, bật nhân viên
  sync                                          Thêm nhân viên/skill/lịch mới từ company/ vào văn phòng đang chạy, rồi bootstrap lại
  new-project <slug> --name "Tên" [--client "Khách"] [--deadline YYYY-MM-DD]
                                                Tạo dự án khách hàng (thư mục + project Paperclip + task khởi tạo cho PM)
  status                                        Tóm tắt nhân viên và tiến độ dự án
  doctor                                        Kiểm tra cài đặt (Node, Claude CLI, Paperclip, 9Router, Pixel Office)
`);
  process.exit(cmd ? 1 : 0);
}
commands[cmd](opts).catch((err) => {
  bad(err.message);
  process.exit(1);
});
