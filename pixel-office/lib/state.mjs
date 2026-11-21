// Gộp dữ liệu Paperclip + báo cáo agent thành trạng thái hiển thị cho Pixel Office.
import fs from "node:fs";
import path from "node:path";

const MEETING_RE = /họp|standup|stand-up|weekly|review tuần|meeting/i;
const REPORT_FRESH_MS = 45 * 60 * 1000;

const ROLE_SPRITE = { ceo: "boss", pm: "pm", researcher: "hunter", cmo: "marketer", engineer: "dev", designer: "designer", qa: "qa", general: "staff" };

const ACTION_VI = {
  "issue.created": "tạo task",
  "issue.updated": "cập nhật task",
  "issue.checked_out": "nhận task",
  "issue.released": "trả task",
  "issue.comment_added": "bình luận",
  "issue.commented": "bình luận",
  "issue.document_updated": "cập nhật tài liệu",
  "approval.created": "gửi yêu cầu duyệt",
  "approval.approved": "đã duyệt",
  "approval.rejected": "từ chối",
  "agent.paused": "tạm dừng",
  "agent.resumed": "tiếp tục",
  "heartbeat.invoked": "được đánh thức",
  "routine.run": "chạy lịch định kỳ",
  "routine.triggered": "lịch định kỳ kích hoạt",
};

function readStatusFile(cwd) {
  if (!cwd) return null;
  try {
    const text = fs.readFileSync(path.join(cwd, "STATUS.md"), "utf8").slice(0, 8000);
    const progress = text.match(/Tiến độ:\**\s*(\d{1,3})\s*%/i);
    const health = text.match(/Sức khỏe:\**\s*(🟢|🟡|🔴)/u);
    const deadline = text.match(/Deadline gần nhất:\**\s*([^\n·]+)/i);
    const updated = text.match(/_Cập nhật:\s*([^_]+)_/);
    return {
      progress: progress ? Math.min(100, Number(progress[1])) : null,
      health: health ? { "🟢": "good", "🟡": "risk", "🔴": "late" }[health[1]] : null,
      deadline: deadline ? deadline[1].trim() : null,
      updated: updated ? updated[1].trim() : null,
    };
  } catch {
    return null;
  }
}

function describeActivity(a, agentsById) {
  const who = a.agentId ? agentsById.get(a.agentId)?.name || "Agent" : a.actorType === "user" ? "Bạn" : "Hệ thống";
  const verb = ACTION_VI[a.action] || a.action.replace(/[._]/g, " ");
  const d = a.details || {};
  const what = [d.identifier, d.title || d.name].filter(Boolean).join(" ");
  return { at: a.createdAt, who, text: `${verb}${what ? ` · ${what}` : ""}`, agentId: a.agentId || null };
}

export function buildState(snap, { reports = {}, paperclipPublicUrl = "", demo = false, now = Date.now() } = {}) {
  const agentsById = new Map(snap.agents.map((a) => [a.id, a]));
  const projectsById = new Map(snap.projects.map((p) => [p.id, p]));
  const issues = snap.issues.filter((i) => !i.hiddenAt);

  // ---- dự án ----
  const projects = snap.projects
    .filter((p) => !p.archivedAt)
    .map((p) => {
      const mine = issues.filter((i) => i.projectId === p.id);
      const counts = { total: mine.length, done: 0, in_progress: 0, in_review: 0, blocked: 0, todo: 0, backlog: 0 };
      for (const i of mine) if (counts[i.status] !== undefined) counts[i.status]++;
      const cwd = p.primaryWorkspace?.cwd || p.workspaces?.find((w) => w.isPrimary)?.cwd || p.workspaces?.[0]?.cwd || null;
      const file = p.statusFile ?? readStatusFile(cwd);
      const issueProgress = counts.total ? Math.round((counts.done / counts.total) * 100) : 0;
      return {
        id: p.id,
        name: p.name,
        color: p.color || "#7c5cff",
        status: p.status,
        counts,
        progress: file?.progress ?? issueProgress,
        progressSource: file?.progress != null ? "STATUS.md" : "task",
        health: file?.health || (counts.blocked > 0 ? "risk" : "good"),
        deadline: file?.deadline || p.targetDate || null,
        statusUpdated: file?.updated || null,
        url: paperclipPublicUrl && snap.company ? `${paperclipPublicUrl.replace(/\/+$/, "")}/${snap.company.issuePrefix || ""}` : null,
      };
    });

  // ---- nhân viên ----
  const activeIssueFor = (agentId) => {
    const mine = issues.filter((i) => i.assigneeAgentId === agentId);
    return (
      mine.find((i) => i.status === "in_progress") ||
      mine.find((i) => i.status === "in_review") ||
      mine.find((i) => i.status === "blocked") ||
      mine.find((i) => i.status === "todo") ||
      null
    );
  };

  const agents = snap.agents
    .filter((a) => a.status !== "terminated")
    .map((a) => {
      const issue = activeIssueFor(a.id);
      const rep = reports[a.id];
      const repFresh = rep && now - Date.parse(rep.at) < REPORT_FRESH_MS ? rep : null;
      const running = a.status === "running";
      const setupError = a.lifecycleState && a.lifecycleState !== "ready" && a.lifecycleError ? a.lifecycleError : null;
      let activity;
      if (setupError) activity = "error";
      else if (a.status === "paused") activity = "paused";
      else if (a.status === "error") activity = "error";
      else if (a.status === "pending_approval") activity = "waiting";
      else if (running) {
        if (repFresh && repFresh.state !== "idle") activity = repFresh.state;
        else if (issue && MEETING_RE.test(issue.title)) activity = "meeting";
        else activity = "working";
      } else activity = issue?.status === "blocked" ? "waiting" : "idle";

      let message = "";
      if (running && repFresh?.message) message = repFresh.message;
      else if (running && issue) message = `Đang làm: ${issue.title}`;
      else if (setupError)
        message = /authenticat|sign in|login/i.test(setupError)
          ? "Chưa đăng nhập Claude Code — chạy `claude` → /login rồi bấm Thử lại xác minh"
          : `Chưa sẵn sàng: ${setupError.split(". ").slice(0, 2).join(". ")}`;
      else if (activity === "paused") message = a.pauseReason ? `Tạm dừng: ${a.pauseReason}` : "Đang tạm dừng";
      else if (activity === "error") message = a.errorReason || "Gặp lỗi ở lượt chạy gần nhất";
      else if (issue?.status === "blocked") message = `Bị chặn: ${issue.title}`;
      else if (issue) message = `Việc kế tiếp: ${issue.title}`;
      else message = "Rảnh — chờ việc";

      const project = issue?.projectId ? projectsById.get(issue.projectId) : null;
      const mineAll = issues.filter((i) => i.assigneeAgentId === a.id);
      const hb = a.runtimeConfig?.heartbeat || {};
      return {
        id: a.id,
        slug: a.metadata?.officeSlug || a.urlKey,
        name: a.name,
        title: a.title || a.role,
        role: a.role,
        sprite: a.metadata?.sprite || ROLE_SPRITE[a.role] || "staff",
        status: a.status,
        activity,
        message,
        progress: running && repFresh?.progress != null ? repFresh.progress : null,
        project: project ? project.name : repFresh?.project || null,
        issue: issue ? { id: issue.id, identifier: issue.identifier, title: issue.title, status: issue.status } : null,
        openTasks: mineAll.filter((i) => i.status !== "done").length,
        doneTasks: mineAll.filter((i) => i.status === "done").length,
        lastHeartbeatAt: a.lastHeartbeatAt || null,
        spentCents: a.spentMonthlyCents || 0,
        budgetCents: a.budgetMonthlyCents || 0,
        model: a.adapterConfig?.model || null,
        adapterType: a.adapterType,
        heartbeat: { enabled: !!hb.enabled, intervalSec: hb.intervalSec || 3600 },
        reportsTo: a.reportsTo || null,
        setupError,
      };
    })
    .sort((x, y) => (x.reportsTo ? 1 : 0) - (y.reportsTo ? 1 : 0) || x.name.localeCompare(y.name));

  // ---- họp ----
  const host = agents.find((a) => a.activity === "meeting");
  const meeting = host
    ? {
        active: true,
        title: host.issue?.title || host.message || "Họp",
        host: host.id,
        participants: agents.filter((a) => !["paused", "error"].includes(a.activity)).map((a) => a.id),
      }
    : { active: false };

  // ---- lịch định kỳ ----
  const routines = snap.routines.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    assignee: agentsById.get(r.assigneeAgentId)?.name || null,
    schedule: (r.triggers || []).filter((t) => t.kind === "schedule").map((t) => t.label || t.cronExpression).join(", "),
    nextRunAt: r.triggers?.map((t) => t.nextRunAt).filter(Boolean).sort()[0] || null,
    lastRunAt: r.lastTriggeredAt || r.lastRun?.createdAt || null,
  }));

  const dash = snap.dashboard || {};
  return {
    ok: true,
    demo,
    error: snap.errors?.length ? snap.errors.join(" · ") : null,
    updatedAt: new Date(now).toISOString(),
    company: snap.company ? { id: snap.company.id, name: snap.company.name } : null,
    paperclipUrl: paperclipPublicUrl || null,
    totals: {
      tasks: dash.tasks || null,
      costs: dash.costs || null,
      pendingApprovals: dash.pendingApprovals ?? snap.approvals.length,
    },
    approvals: snap.approvals.slice(0, 10).map((x) => ({ id: x.id, title: x.title || x.type || "Yêu cầu duyệt", createdAt: x.createdAt })),
    meeting,
    agents,
    projects,
    routines,
    activity: snap.activity.slice(0, 25).map((a) => describeActivity(a, agentsById)),
  };
}
