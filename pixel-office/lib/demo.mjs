// Nguồn dữ liệu giả lập để xem thử dashboard khi chưa nối Paperclip (PIXEL_OFFICE_DEMO=1 hoặc --demo).
// Kịch bản lặp mỗi 90 giây: họp sáng → mọi người về bàn làm việc → nghỉ.

const T0 = Date.now();
const id = (s) => `demo-${s}`;

export class DemoSource {
  constructor() {
    this.paused = new Set(["seo"]);
    this.listeners = [];
    this.routineStatus = {};
    this.threads = new Map(); // issueId → tin nhắn (bộ nhớ tạm của demo)
    const t = (sec) => new Date(Date.now() - sec * 1000).toISOString();
    const m = (agent, body, sec) => ({ id: `m${Math.random().toString(36).slice(2, 9)}`, author: agent ? "agent" : "user", agentId: agent ? id(agent) : null, body, createdAt: t(sec), images: [], files: [] });
    this.threads.set(id("i1"), [
      m("manager", "**Họp sáng 19/11** — chương trình: 1) tiến độ dự án 2) job mới 3) cải tiến văn phòng. Mời mọi người phát biểu ngắn.", 120),
      m("pm", "Shop ABC 64%, giỏ hàng xong hôm nay. SEO XYZ **bị chặn**: chờ khách gửi danh sách từ khoá.", 95),
      m("job-hunter", "Quét 24 job, 3 job ≥ 75 điểm, đã viết proposal nháp — chờ anh duyệt.", 70),
      m("engineer", "Đã thêm nguồn job PeoplePerHour (chờ duyệt nhánh eng/AIO-9). Đề xuất: thêm nút 'Duyệt nhanh' proposal ngay trong văn phòng.", 40),
    ]);
  }

  async getChat(agentId) {
    const issueId = `demo-chat-${agentId}`;
    if (!this.threads.has(issueId)) {
      this.threads.set(issueId, [
        { id: `w-${agentId}`, author: "agent", agentId, body: "Chào anh! Đây là chế độ demo — tin nhắn không gửi tới nhân viên thật.", createdAt: new Date().toISOString(), images: [], files: [] },
      ]);
    }
    return { id: issueId, identifier: "DEMO", title: "Chat (demo)" };
  }

  async thread(issueId) {
    return [...(this.threads.get(issueId) || [])];
  }

  async postMessage(issueId, { body, images = [] }) {
    const list = this.threads.get(issueId) || [];
    this.threads.set(issueId, list);
    const msg = {
      id: `u${Date.now()}`,
      author: "user",
      agentId: null,
      body,
      createdAt: new Date().toISOString(),
      images: images.map((img, i) => ({ id: `img${Date.now()}${i}`, name: img.name, type: img.type, url: `data:${img.type};base64,${img.buffer.toString("base64")}` })),
      files: [],
    };
    list.push(msg);
    const agentId = issueId.startsWith("demo-chat-") ? issueId.slice("demo-chat-".length) : id("manager");
    setTimeout(() => {
      list.push({
        id: `a${Date.now()}`,
        author: "agent",
        agentId,
        body: `Đã nhận${images.length ? ` kèm ${images.length} ảnh` : ""}. (demo) Mình sẽ xử lý và báo lại ngay trong cuộc chat này.`,
        createdAt: new Date().toISOString(),
        images: [],
        files: [],
      });
    }, 1500);
    return { id: msg.id };
  }

  onLiveEvent(fn) {
    this.listeners.push(fn);
    setInterval(() => this.listeners.forEach((f) => f()), 3000);
  }

  async snapshot() {
    const t = ((Date.now() - T0) / 1000) % 90; // giây trong chu kỳ
    const meeting = t < 18;
    const now = new Date().toISOString();

    const agentDefs = [
      { s: "manager", name: "Chánh Văn Phòng", title: "Chánh văn phòng (Office Manager)", role: "ceo", sprite: "boss", reportsTo: null, model: "claude-sonnet-5-5" },
      { s: "pm", name: "Quản Lý Dự Án", title: "Project Manager — dự án khách hàng", role: "pm", sprite: "pm", reportsTo: "manager", model: "claude-sonnet-5-5" },
      { s: "job-hunter", name: "Săn Job", title: "Freelance Job Hunter", role: "researcher", sprite: "hunter", reportsTo: "manager", model: "claude-haiku-5-5" },
      { s: "marketing", name: "Marketing", title: "Content & Social (sắp tuyển)", role: "cmo", sprite: "marketer", reportsTo: "manager", model: "claude-sonnet-5-5" },
      { s: "assistant", name: "Trợ Lý", title: "Trợ lý riêng (Gemini)", role: "general", sprite: "assistant", reportsTo: "manager", model: "auto", adapterType: "gemini_local" },
      { s: "engineer", name: "Kỹ Sư Văn Phòng", title: "Kỹ sư phát triển văn phòng", role: "engineer", sprite: "dev", reportsTo: "manager", model: "claude-sonnet-5-5" },
      { s: "seo", name: "SEO", title: "SEO Specialist (sắp tuyển)", role: "general", sprite: "designer", reportsTo: "manager", model: "claude-haiku-5-5" },
    ];

    const running = (s) => {
      if (this.paused.has(s)) return false;
      if (meeting) return s === "manager";
      if (s === "pm") return t < 60;
      if (s === "job-hunter") return t > 25 && t < 75;
      if (s === "marketing") return t > 40;
      if (s === "engineer") return t > 20 && t < 80;
      if (s === "assistant") return t > 30 && t < 55;
      return false;
    };

    const agents = agentDefs.map((d) => ({
      id: id(d.s),
      name: d.name,
      title: d.title,
      role: d.role,
      urlKey: d.s,
      status: this.paused.has(d.s) ? "paused" : running(d.s) ? "running" : "idle",
      pauseReason: this.paused.has(d.s) ? "Chưa kích hoạt" : null,
      metadata: { officeSlug: d.s, sprite: d.sprite },
      reportsTo: d.reportsTo ? id(d.reportsTo) : null,
      adapterType: d.adapterType || "claude_local",
      adapterConfig: { model: d.model },
      runtimeConfig: { heartbeat: { enabled: false, intervalSec: 3600 } },
      lastHeartbeatAt: now,
      spentMonthlyCents: 0,
      budgetMonthlyCents: 0,
    }));

    const projects = [
      { id: id("p-office"), name: "Vận hành văn phòng", color: "#7c5cff", status: "in_progress", statusFile: { progress: null, health: "good" } },
      { id: id("p-shop"), name: "Website Shop ABC", color: "#22c55e", status: "in_progress", statusFile: { progress: 64, health: "good", deadline: "25/11 — Bàn giao giỏ hàng", updated: "hôm nay 07:42" } },
      { id: id("p-seo"), name: "SEO Blog XYZ", color: "#f59e0b", status: "in_progress", statusFile: { progress: 35, health: "risk", deadline: "22/11 — 10 bài pillar", updated: "hôm qua 16:40" } },
      { id: id("p-dev"), name: "Phát triển văn phòng", color: "#3a86ff", status: "in_progress", statusFile: { progress: null, health: "good" } },
      { id: id("p-video"), name: "Video AI cho Studio K", color: "#ec4899", status: "planned", statusFile: { progress: 10, health: "good", deadline: "05/12 — kịch bản 3 video", updated: "18/11" } },
    ];

    let n = 0;
    const issue = (title, status, agent, project) => ({ id: id(`i${++n}`), identifier: `AIO-${n}`, title, status, assigneeAgentId: agent ? id(agent) : null, projectId: id(project) });
    const issues = [
      issue("Họp sáng (daily standup) — 19/11", meeting ? "in_progress" : "done", "manager", "p-office"),
      issue("Rà soát dự án khách hàng", running("pm") ? "in_progress" : "done", "pm", "p-office"),
      issue("Quét job freelance — ca chiều", running("job-hunter") ? "in_progress" : "todo", "job-hunter", "p-office"),
      issue("Tích hợp cổng thanh toán VNPay", "done", "pm", "p-shop"),
      issue("Trang giỏ hàng responsive", "in_progress", "pm", "p-shop"),
      issue("Kiểm thử checkout", "todo", "pm", "p-shop"),
      issue("Viết 10 bài pillar", "blocked", "pm", "p-seo"),
      issue("Audit kỹ thuật SEO", "done", "pm", "p-seo"),
      issue("Lên lịch nội dung tháng 12", running("marketing") ? "in_progress" : "todo", "marketing", "p-seo"),
      issue("Thêm nguồn job PeoplePerHour", running("engineer") ? "in_progress" : "in_review", "engineer", "p-dev"),
      issue("Kịch bản video 1", "todo", null, "p-video"),
    ];

    const routines = [
      { id: id("r1"), title: "Họp sáng (daily standup)", status: this.routineStatus.r1 || "active", assigneeAgentId: id("manager"), triggers: [{ kind: "schedule", label: "8:05 sáng T2–T7" }] },
      { id: id("r2"), title: "Review tuần (weekly review)", status: this.routineStatus.r2 || "active", assigneeAgentId: id("manager"), triggers: [{ kind: "schedule", label: "Thứ Hai 9:10" }] },
      { id: id("r3"), title: "Quét job freelance", status: this.routineStatus.r3 || "active", assigneeAgentId: id("job-hunter"), triggers: [{ kind: "schedule", label: "7:20, 13:20, 19:20" }] },
      { id: id("r4"), title: "Rà soát dự án khách hàng", status: this.routineStatus.r4 || "active", assigneeAgentId: id("pm"), triggers: [{ kind: "schedule", label: "7:40 và 16:40 T2–T7" }] },
    ];

    const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
    const activity = [
      { createdAt: ago(20), agentId: id("job-hunter"), action: "approval.created", details: { title: "3 proposal chờ duyệt (Upwork, Freelancer)" } },
      { createdAt: ago(95), agentId: id("pm"), action: "issue.updated", details: { identifier: "AIO-5", title: "Trang giỏ hàng responsive" } },
      { createdAt: ago(300), agentId: id("manager"), action: "issue.document_updated", details: { title: "Biên bản họp sáng 19/11" } },
      { createdAt: ago(900), agentId: id("pm"), action: "issue.created", details: { identifier: "AIO-7", title: "Viết 10 bài pillar" } },
      { createdAt: ago(3600), actorType: "user", action: "approval.approved", details: { title: "Proposal: WooCommerce store redesign" } },
    ];

    return {
      company: { id: "demo", name: "AI Office (demo)" },
      agents,
      projects,
      issues,
      routines,
      dashboard: { tasks: { open: 6, inProgress: 3, blocked: 1, done: 3 }, costs: { monthSpendCents: 0, monthBudgetCents: 0 }, pendingApprovals: 2 },
      approvals: [
        { id: id("a1"), title: "3 proposal chờ duyệt (Upwork, Freelancer)", createdAt: ago(20) },
        { id: id("a2"), title: "Email cập nhật tiến độ cho Shop ABC", createdAt: ago(1800) },
      ],
      activity,
      errors: [],
      reports: {
        [id("manager")]: { state: "meeting", message: "Chủ trì họp sáng: 3 dự án, 1 task bị chặn", progress: Math.round((t / 18) * 100), at: now },
        [id("pm")]: { state: "working", message: "Cập nhật STATUS.md của Shop ABC", progress: Math.round((t / 60) * 100), at: now },
        [id("job-hunter")]: { state: t < 50 ? "researching" : "writing", message: t < 50 ? "Đang chấm 24 job mới (GPT-6 lọc thô)" : "Viết proposal nháp cho 3 job ≥ 75 điểm", progress: Math.round(((t - 25) / 50) * 100), at: now },
        [id("assistant")]: { state: "working", message: "Tóm tắt 6 email mới — 2 việc cần anh quyết, 3 job chuyển cho Săn Job", progress: Math.round(((t - 30) / 25) * 100), at: now },
        [id("engineer")]: { state: "working", message: "Viết code nguồn job PeoplePerHour trên nhánh eng/AIO-9", progress: Math.round(((t - 20) / 60) * 100), at: now },
        [id("marketing")]: { state: "writing", message: "Soạn lịch nội dung tháng 12", progress: Math.round(((t - 40) / 50) * 100), at: now },
      },
    };
  }

  async agentAction(agentId, action) {
    const s = agentId.replace(/^demo-/, "");
    if (action === "pause") this.paused.add(s);
    if (action === "resume") this.paused.delete(s);
    return { demo: true, action };
  }
  async setHeartbeat() {
    return { demo: true };
  }
  async setModel() {
    return { demo: true };
  }
  async routineAction(routineId, action) {
    const k = routineId.replace(/^demo-/, "");
    if (action === "pause") this.routineStatus[k] = "paused";
    if (action === "activate") this.routineStatus[k] = "active";
    return { demo: true, action };
  }
}
