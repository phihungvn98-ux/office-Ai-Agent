import { W, H, LOOKS, drawCharacter, drawRoom, sceneProps, drawEmote, layout, planPath } from "./office.js";

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const ACTIVITY = {
  working: { label: "Đang làm", cls: "work" },
  writing: { label: "Đang viết", cls: "work" },
  researching: { label: "Nghiên cứu", cls: "work" },
  meeting: { label: "Đang họp", cls: "meet" },
  waiting: { label: "Chờ", cls: "wait" },
  idle: { label: "Rảnh", cls: "idle" },
  paused: { label: "Tạm dừng", cls: "off" },
  error: { label: "Lỗi", cls: "err" },
};
const HEALTH = { good: ["Đúng hạn", "good"], risk: ["Có rủi ro", "risk"], late: ["Trễ", "late"] };

let state = null;
let selected = null;
const actors = new Map();

// ---------------- canvas ----------------
const canvas = $("#office");
const ctx = canvas.getContext("2d");
canvas.width = W;
canvas.height = H;
const overlay = $("#overlay");

function lookFor(a) {
  return LOOKS[a.sprite] || LOOKS.staff;
}

function targetFor(a, L, idx) {
  const desk = L.desks[idx.desk];
  if (state.meeting?.active && state.meeting.participants.includes(a.id)) {
    const k = state.meeting.participants.indexOf(a.id);
    const s = L.meetSeats[k % L.meetSeats.length];
    return { x: s.x, y: s.y, dir: s.dir, pose: "sit", where: "meeting" };
  }
  if (a.activity === "idle") {
    const s = L.lounge[idx.lounge % L.lounge.length];
    return { x: s.x, y: s.y, dir: s.dir, pose: s.pose, where: "lounge" };
  }
  return { x: desk.seat.x, y: desk.seat.y, dir: "down", pose: "sit", where: "desk" };
}

function syncActors() {
  const L = layout(state.agents.length);
  let lounge = 0;
  const seen = new Set();
  state.agents.forEach((a, i) => {
    seen.add(a.id);
    const idx = { desk: i, lounge: a.activity === "idle" ? lounge++ : 0 };
    const tgt = targetFor(a, L, idx);
    let act = actors.get(a.id);
    if (!act) {
      act = { id: a.id, x: tgt.x, y: tgt.y, path: [], frame: 0, dir: tgt.dir, pose: tgt.pose, target: tgt, el: makeTag(a) };
      actors.set(a.id, act);
    } else if (act.target.x !== tgt.x || act.target.y !== tgt.y) {
      act.path = reduceMotion ? [] : planPath({ x: act.x, y: act.y }, tgt);
      if (reduceMotion) Object.assign(act, { x: tgt.x, y: tgt.y });
    }
    act.target = tgt;
    act.agent = a;
    act.desk = i;
    updateTag(act);
  });
  for (const [id, act] of actors) if (!seen.has(id)) (act.el.remove(), actors.delete(id));
}

function makeTag(a) {
  const el = document.createElement("button");
  el.className = "tag";
  el.type = "button";
  el.innerHTML = `<span class="bubble"><span class="txt"></span></span><span class="name"></span>`;
  el.addEventListener("click", () => selectAgent(a.id));
  overlay.appendChild(el);
  return el;
}

function updateTag(act) {
  const a = act.agent;
  const showBubble = !["idle"].includes(a.activity) || selected === a.id;
  const msg = a.message.length > 140 ? a.message.slice(0, 138) + "…" : a.message;
  act.el.querySelector(".name").textContent = a.name;
  const b = act.el.querySelector(".bubble");
  b.firstChild.textContent = msg;
  b.hidden = !showBubble;
  act.el.dataset.activity = a.activity;
  act.el.dataset.where = act.target?.where || "";
  act.el.classList.toggle("selected", selected === a.id);
  act.el.setAttribute("aria-label", `${a.name}: ${ACTIVITY[a.activity]?.label || a.activity}. ${a.message}`);
}

let last = performance.now();
function frame(t) {
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  if (state) {
    const L = layout(state.agents.length);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, W, H);
    drawRoom(ctx, L, t, state.meeting?.active);

    const deskStates = L.desks.map((_, i) => {
      const act = [...actors.values()].find((x) => x.desk === i);
      if (!act) return "empty";
      const atDesk = act.target.where === "desk" && act.path.length === 0;
      return atDesk ? act.agent.activity : "away";
    });
    const props = sceneProps(L, deskStates);

    const drawables = [];
    for (const p of props) drawables.push({ y: p.y - (p.behind ? 0.5 : 0), draw: () => p.draw(ctx, t) });
    for (const act of actors.values()) {
      // di chuyển
      if (act.path.length) {
        const nxt = act.path[0];
        const dx = nxt.x - act.x, dy = nxt.y - act.y;
        const dist = Math.hypot(dx, dy);
        const sp = 46 * dt;
        if (dist <= sp) {
          act.x = nxt.x;
          act.y = nxt.y;
          act.path.shift();
        } else {
          act.x += (dx / dist) * sp;
          act.y += (dy / dist) * sp;
        }
        act.walkDir = dy < -0.5 ? "up" : "down";
        act.frame = Math.floor(t / 160);
      }
      const walking = act.path.length > 0;
      const a = act.agent;
      const typing = !walking && act.target.where === "desk" && ["working", "writing", "researching"].includes(a.activity);
      drawables.push({
        y: act.y,
        draw: () => {
          drawCharacter(ctx, act.x, act.y, lookFor(a), {
            dir: walking ? act.walkDir : act.target.dir,
            pose: walking ? "walk" : act.target.pose,
            frame: walking ? act.frame : Math.floor(t / 220),
            typing,
            sleep: a.activity === "paused",
            dim: a.activity === "paused",
          });
          if (!walking) {
            if (a.activity === "paused") drawEmote(ctx, act.x, act.y, "sleep", t);
            else if (a.activity === "error") drawEmote(ctx, act.x, act.y, "error", t);
            else if (a.activity === "waiting") drawEmote(ctx, act.x, act.y, "waiting", t);
            else if (act.target.where === "lounge") drawEmote(ctx, act.x, act.y, "coffee", t);
          }
        },
      });
    }
    drawables.sort((p, q) => p.y - q.y).forEach((d) => d.draw());

    // nhãn DOM
    const scale = canvas.clientWidth / W;
    if (scale !== frame.scale) overlay.style.setProperty("--s", (frame.scale = scale));
    for (const act of actors.values()) {
      act.el.style.transform = `translate(${Math.round(act.x * scale)}px, ${Math.round(act.y * scale)}px)`;
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------------- panels ----------------
function ago(iso) {
  if (!iso) return "—";
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "vừa xong";
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  return `${Math.floor(s / 86400)} ngày trước`;
}

function avatar(a, size = 2) {
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = 24;
  c.className = "avatar";
  c.style.width = `${16 * size}px`;
  c.style.height = `${24 * size}px`;
  const x = c.getContext("2d");
  drawCharacter(x, 8, 23, lookFor(a), { dir: "down", pose: "stand", dim: a.activity === "paused" });
  return c;
}

function chip(activity) {
  const m = ACTIVITY[activity] || { label: activity, cls: "idle" };
  return `<span class="chip ${m.cls}">${m.label}</span>`;
}

function bar(pct, color) {
  const v = Math.max(0, Math.min(100, Math.round(pct ?? 0)));
  return `<div class="bar" role="progressbar" aria-valuenow="${v}" aria-valuemin="0" aria-valuemax="100"><span style="width:${v}%;${color ? `background:${color}` : ""}"></span></div>`;
}

function renderKpis() {
  const s = state;
  const running = s.projects.filter((p) => p.status !== "completed" && p.status !== "cancelled").length;
  const t = s.totals.tasks || {};
  const cost = s.totals.costs?.monthSpendCents;
  const items = [
    ["Dự án", running],
    ["Đang làm", t.inProgress ?? s.agents.filter((a) => a.activity !== "idle" && a.activity !== "paused").length],
    ["Bị chặn", t.blocked ?? 0],
    ["Chờ duyệt", s.totals.pendingApprovals ?? 0],
    ["Chi phí tháng", cost != null ? `$${(cost / 100).toFixed(2)}` : "—"],
  ];
  $("#kpis").innerHTML = items.map(([k, v]) => `<div class="kpi"><div class="kpi-v">${esc(v)}</div><div class="kpi-k">${k}</div></div>`).join("");
}

function renderAgents() {
  const list = $("#tab-agents");
  list.innerHTML = "";
  for (const a of state.agents) {
    const card = document.createElement("article");
    card.className = "card agent" + (selected === a.id ? " selected" : "");
    card.tabIndex = 0;
    card.addEventListener("click", () => selectAgent(a.id));
    card.innerHTML = `
      <div class="agent-head">
        <div class="av"></div>
        <div class="who"><div class="nm">${esc(a.name)}</div><div class="tt">${esc(a.title)}</div></div>
        ${chip(a.activity)}
      </div>
      <p class="msg">${esc(a.message)}</p>
      ${a.progress != null ? bar(a.progress) : ""}
      <div class="meta">
        ${a.issue ? `<span title="${esc(a.issue.title)}">📌 ${esc(a.issue.identifier || "")} ${esc(a.issue.title)}</span>` : ""}
        ${a.project ? `<span>📁 ${esc(a.project)}</span>` : ""}
        <span>✅ ${a.doneTasks} xong · ${a.openTasks} mở</span>
        <span>🧠 ${esc(a.model || "—")}</span>
        <span>⏱ ${ago(a.lastHeartbeatAt)}</span>
      </div>`;
    card.querySelector(".av").appendChild(avatar(a));
    list.appendChild(card);
  }
}

function renderProjects() {
  $("#tab-projects").innerHTML = state.projects
    .map((p) => {
      const [hl, hc] = HEALTH[p.health] || HEALTH.good;
      const c = p.counts;
      return `<article class="card project">
        <div class="proj-head"><span class="dot" style="background:${esc(p.color)}"></span><span class="nm">${esc(p.name)}</span><span class="chip ${hc}">${hl}</span></div>
        <div class="proj-pct"><strong>${p.progress}%</strong><small>${p.progressSource === "STATUS.md" ? "theo STATUS.md" : "theo task"}</small></div>
        ${bar(p.progress, p.color)}
        <div class="meta">
          <span>${c.done}/${c.total} task xong</span>
          ${c.in_progress ? `<span>${c.in_progress} đang làm</span>` : ""}
          ${c.blocked ? `<span class="warn">${c.blocked} bị chặn</span>` : ""}
          ${p.deadline ? `<span>⏰ ${esc(p.deadline)}</span>` : ""}
          ${p.statusUpdated ? `<span>Cập nhật ${esc(p.statusUpdated)}</span>` : ""}
        </div>
      </article>`;
    })
    .join("") || `<p class="empty">Chưa có dự án. Tạo bằng <code>node scripts/office.mjs new-project</code>.</p>`;
}

function renderActivity() {
  const ap = state.approvals.length
    ? `<section class="card approvals"><h3>Chờ bạn duyệt (${state.approvals.length})</h3><ul>${state.approvals
        .map((x) => `<li>${esc(x.title)} <small>${ago(x.createdAt)}</small></li>`)
        .join("")}</ul>${state.paperclipUrl ? `<a class="btn" href="${esc(state.paperclipUrl)}">Mở Paperclip để duyệt →</a>` : ""}</section>`
    : "";
  $("#tab-activity").innerHTML =
    ap +
    `<ul class="feed">${state.activity
      .map((x) => `<li><span class="when">${ago(x.at)}</span><strong>${esc(x.who)}</strong> ${esc(x.text)}</li>`)
      .join("")}</ul>`;
}

const MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];
const INTERVALS = [[1800, "30 phút"], [3600, "1 giờ"], [7200, "2 giờ"], [14400, "4 giờ"], [28800, "8 giờ"]];

function renderSettings() {
  const el = $("#tab-settings");
  if (el.contains(document.activeElement) && document.activeElement.tagName === "SELECT") return; // đừng phá dropdown đang mở
  el.innerHTML = `
    <section class="card"><h3>Nhân viên</h3>
    ${state.agents
      .map(
        (a) => `<div class="set-row" data-agent="${a.id}">
        <div class="set-who"><strong>${esc(a.name)}</strong> ${chip(a.activity)}</div>
        <div class="set-ctl">
          ${a.setupError ? `<button class="btn" data-act="retry">🔄 Thử lại xác minh</button>` : ""}
          ${a.activity === "paused" || a.status === "paused"
            ? `<button class="btn" data-act="resume">▶ Tiếp tục</button>`
            : `<button class="btn ghost" data-act="pause">⏸ Tạm dừng</button>`}
          <button class="btn ghost" data-act="wake" ${a.status === "paused" || a.setupError ? "disabled" : ""}>⚡ Đánh thức</button>
          <label class="sel">Model
            <select data-set="model">${[...new Set([a.model, ...MODELS].filter(Boolean))].map((m) => `<option ${m === a.model ? "selected" : ""}>${esc(m)}</option>`).join("")}</select>
          </label>
          <label class="sel">Tự thức dậy
            <select data-set="heartbeat">
              <option value="0" ${!a.heartbeat.enabled ? "selected" : ""}>Tắt (chỉ theo lịch/giao việc)</option>
              ${INTERVALS.map(([v, l]) => `<option value="${v}" ${a.heartbeat.enabled && a.heartbeat.intervalSec === v ? "selected" : ""}>Mỗi ${l}</option>`).join("")}
            </select>
          </label>
        </div></div>`,
      )
      .join("")}
    </section>
    <section class="card"><h3>Lịch định kỳ (họp, quét job…)</h3>
    ${state.routines
      .map(
        (r) => `<div class="set-row" data-routine="${r.id}">
        <div class="set-who"><strong>${esc(r.title)}</strong><small>${esc(r.assignee || "")} · ${esc(r.schedule || "thủ công")}</small></div>
        <div class="set-ctl">
          <button class="btn" data-ract="run">▶ Chạy ngay</button>
          ${r.status === "active" ? `<button class="btn ghost" data-ract="pause">⏸ Tắt lịch</button>` : `<button class="btn ghost" data-ract="activate">✓ Bật lịch</button>`}
          <span class="chip ${r.status === "active" ? "good" : "off"}">${r.status === "active" ? "Đang bật" : "Đang tắt"}</span>
        </div></div>`,
      )
      .join("") || `<p class="empty">Chưa có lịch.</p>`}
    </section>
    <section class="card"><h3>Kết nối</h3>
      <p class="small">Nguồn dữ liệu: ${state.demo ? "<strong>DEMO</strong> (dữ liệu giả lập)" : `Paperclip ${state.paperclipUrl ? `<a href="${esc(state.paperclipUrl)}" target="_blank" rel="noopener">${esc(state.paperclipUrl)}</a>` : ""}`}</p>
      <p class="small">Cập nhật lúc ${new Date(state.updatedAt).toLocaleTimeString("vi-VN")}${state.error ? ` · <span class="warn">${esc(state.error)}</span>` : ""}</p>
    </section>`;
}

async function post(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function toast(msg, bad = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = bad ? "show bad" : "show";
  clearTimeout(toast.h);
  toast.h = setTimeout(() => (t.className = ""), 3200);
}

$("#tab-settings").addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  const row = b.closest(".set-row");
  try {
    b.disabled = true;
    if (b.dataset.act) {
      await post(`api/agents/${row.dataset.agent}/${b.dataset.act}`);
      toast({ pause: "Đã tạm dừng", resume: "Đã cho làm tiếp", wake: "Đã đánh thức — agent sẽ chạy 1 lượt", retry: "Đang xác minh lại…" }[b.dataset.act]);
    } else if (b.dataset.ract) {
      await post(`api/routines/${row.dataset.routine}/${b.dataset.ract}`);
      toast({ run: "Đã chạy ngay", pause: "Đã tắt lịch", activate: "Đã bật lịch" }[b.dataset.ract]);
    }
  } catch (err) {
    toast(`Lỗi: ${err.message}`, true);
  } finally {
    b.disabled = false;
  }
});

$("#tab-settings").addEventListener("change", async (e) => {
  const s = e.target.closest("select");
  if (!s) return;
  const id = s.closest(".set-row").dataset.agent;
  try {
    if (s.dataset.set === "model") {
      await post(`api/agents/${id}/model`, { model: s.value });
      toast(`Đã đổi model: ${s.value}`);
    } else {
      const v = Number(s.value);
      await post(`api/agents/${id}/heartbeat`, { enabled: v > 0, intervalSec: v || 3600 });
      toast(v ? "Đã bật tự thức dậy" : "Đã tắt tự thức dậy");
    }
    s.blur();
  } catch (err) {
    toast(`Lỗi: ${err.message}`, true);
  }
});

function selectAgent(id) {
  selected = selected === id ? null : id;
  showTab("agents");
  render();
  const card = [...document.querySelectorAll(".card.agent")][state.agents.findIndex((a) => a.id === id)];
  card?.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
}

// tabs
function showTab(name) {
  for (const b of document.querySelectorAll("[role=tab]")) {
    const on = b.dataset.tab === name;
    b.setAttribute("aria-selected", on);
    $(`#tab-${b.dataset.tab}`).hidden = !on;
  }
  try {
    localStorage.setItem("pixel-office-tab", name);
  } catch {}
}
for (const b of document.querySelectorAll("[role=tab]")) b.addEventListener("click", () => showTab(b.dataset.tab));
try {
  showTab(localStorage.getItem("pixel-office-tab") || "agents");
} catch {
  showTab("agents");
}

function render() {
  if (!state) return;
  $("#company").textContent = state.company?.name || "AI Office";
  $("#meeting").hidden = !state.meeting?.active;
  if (state.meeting?.active) $("#meeting").textContent = `🗣 Đang họp: ${state.meeting.title}`;
  $("#err").hidden = !state.error;
  $("#err").textContent = state.error || "";
  const pc = $("#open-paperclip");
  pc.hidden = !state.paperclipUrl || state.demo;
  if (state.paperclipUrl) pc.href = state.paperclipUrl;
  renderKpis();
  renderAgents();
  renderProjects();
  renderActivity();
  renderSettings();
  syncActors();
}

// ---------------- dữ liệu realtime ----------------
function connect() {
  const es = new EventSource("api/stream");
  es.addEventListener("state", (e) => {
    state = JSON.parse(e.data);
    $("#live").className = state.ok ? "live on" : "live off";
    $("#live").title = state.ok ? "Đang kết nối realtime" : state.error || "Mất kết nối";
    render();
  });
  es.onerror = () => {
    $("#live").className = "live off";
  };
}
connect();

setInterval(() => {
  $("#clock").textContent = new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}, 1000);
