// Client tối giản cho Paperclip REST API + live events WebSocket.

export class PaperclipClient {
  constructor({ baseUrl, apiKey, companyId, companyName }) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.companyId = companyId || null;
    this.companyName = companyName;
    this.listeners = [];
    this.ws = null;
    this.wsRetry = 0;
    this.closed = false;
  }

  async api(pathname, init = {}) {
    const headers = { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}) };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    let res;
    try {
      res = await fetch(`${this.baseUrl}/api${pathname}`, { ...init, headers, signal: AbortSignal.timeout(15000) });
    } catch (err) {
      throw new Error(`Không kết nối được Paperclip tại ${this.baseUrl} (${err.cause?.code || err.name})`);
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const e = new Error(`Paperclip ${res.status} ${pathname}: ${data?.error || String(text).slice(0, 200)}`);
      e.status = res.status === 401 || res.status === 403 ? res.status : 502;
      throw e;
    }
    return data;
  }

  async resolveCompany() {
    if (this.companyId) return this.companyId;
    const list = await this.api("/companies");
    if (!Array.isArray(list) || list.length === 0) throw new Error("Paperclip chưa có company nào — chạy `node scripts/office.mjs bootstrap`");
    const found = list.find((c) => c.name === this.companyName) || list[0];
    this.companyId = found.id;
    this.connectLive();
    return this.companyId;
  }

  async snapshot() {
    const c = await this.resolveCompany();
    const q = (p) => this.api(p).catch((err) => ({ __error: err.message }));
    const [company, agents, projects, issues, routines, dashboard, approvals, activity] = await Promise.all([
      this.api(`/companies/${c}`),
      this.api(`/companies/${c}/agents`),
      q(`/companies/${c}/projects`),
      q(`/companies/${c}/issues?status=backlog,todo,in_progress,in_review,blocked,done&limit=500`),
      q(`/companies/${c}/routines`),
      q(`/companies/${c}/dashboard`),
      q(`/companies/${c}/approvals?status=pending`),
      q(`/companies/${c}/activity?limit=30`),
    ]);
    const arr = (v) => (Array.isArray(v) ? v : Array.isArray(v?.items) ? v.items : []);
    return {
      company,
      agents: arr(agents),
      projects: arr(projects),
      issues: arr(issues),
      routines: arr(routines),
      dashboard: dashboard?.__error ? null : dashboard,
      approvals: arr(approvals),
      activity: arr(activity),
      errors: [projects, issues, routines, dashboard, approvals, activity].filter((x) => x?.__error).map((x) => x.__error),
    };
  }

  // ---- điều khiển ----
  agentAction(id, action) {
    if (action === "retry") return this.api(`/agents/${id}/lifecycle/retry`, { method: "POST", body: "{}" });
    if (action === "wake") return this.api(`/agents/${id}/heartbeat/invoke`, { method: "POST", body: "{}" });
    return this.api(`/agents/${id}/${action}`, { method: "POST", body: "{}" });
  }

  async setHeartbeat(id, { enabled, intervalSec }) {
    const agent = await this.api(`/agents/${id}`);
    const runtimeConfig = { ...(agent.runtimeConfig || {}) };
    runtimeConfig.heartbeat = { ...(runtimeConfig.heartbeat || {}), enabled, intervalSec: Math.max(300, intervalSec) };
    return this.api(`/agents/${id}`, { method: "PATCH", body: JSON.stringify({ runtimeConfig }) });
  }

  async setModel(id, model) {
    const agent = await this.api(`/agents/${id}`);
    const adapterConfig = { ...(agent.adapterConfig || {}), model };
    return this.api(`/agents/${id}`, { method: "PATCH", body: JSON.stringify({ adapterConfig }) });
  }

  routineAction(id, action) {
    if (action === "run") return this.api(`/routines/${id}/run`, { method: "POST", body: JSON.stringify({ source: "manual" }) });
    return this.api(`/routines/${id}`, { method: "PATCH", body: JSON.stringify({ status: action === "pause" ? "paused" : "active" }) });
  }

  // ---- chat & thread (Agent Chat của Paperclip = 1 issue/cặp nhân viên–bạn; phòng họp = task họp) ----
  async getChat(agentId) {
    const c = await this.resolveCompany();
    const id = encodeURIComponent(agentId);
    // Chưa có chat: Paperclip trả 200 + null (bản cũ có thể trả 404) → tạo mới.
    let chat = null;
    try {
      chat = await this.api(`/companies/${c}/chats/${id}`);
    } catch (err) {
      if (!/ 404 /.test(err.message)) throw err;
    }
    if (!chat?.id) chat = await this.api(`/companies/${c}/chats/${id}`, { method: "POST", body: "{}" });
    if (!chat?.id) throw new Error("Paperclip không tạo được cuộc chat");
    return chat;
  }

  async thread(issueId, limit = 60) {
    const [comments, attachments] = await Promise.all([
      this.api(`/issues/${issueId}/comments?order=desc&limit=${limit}`),
      this.api(`/issues/${issueId}/attachments`).catch(() => []),
    ]);
    const byComment = new Map();
    for (const a of Array.isArray(attachments) ? attachments : []) {
      if (!a.issueCommentId) continue;
      if (!byComment.has(a.issueCommentId)) byComment.set(a.issueCommentId, []);
      byComment.get(a.issueCommentId).push(a);
    }
    return (Array.isArray(comments) ? comments : [])
      .filter((m) => !m.deletedAt)
      .map((m) => {
        const files = (byComment.get(m.id) || []).map((a) => ({
          id: a.id,
          name: a.originalFilename || "file",
          type: a.contentType || "",
          url: `/api/attachments/${a.id}/content`,
        }));
        const agentId = m.authorAgentId || m.derivedAuthorAgentId || null;
        return {
          id: m.id,
          author: agentId ? "agent" : m.authorType === "user" ? "user" : "system",
          agentId,
          body: m.body || "",
          createdAt: m.createdAt,
          images: files.filter((f) => f.type.startsWith("image/")),
          files: files.filter((f) => !f.type.startsWith("image/")),
        };
      })
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }

  async postMessage(issueId, { body, images = [] }) {
    const c = await this.resolveCompany();
    const attachmentIds = [];
    for (const img of images) {
      const fd = new FormData();
      fd.append("file", new Blob([img.buffer], { type: img.type }), img.name);
      const headers = { accept: "application/json" };
      if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
      const res = await fetch(`${this.baseUrl}/api/companies/${c}/issues/${issueId}/attachments`, {
        method: "POST",
        headers,
        body: fd,
        signal: AbortSignal.timeout(60000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const e = new Error(`Tải ảnh "${img.name}" lên Paperclip lỗi ${res.status}: ${data.error || ""}`);
        e.status = res.status === 413 || res.status === 422 ? 400 : 502;
        throw e;
      }
      attachmentIds.push(data.id);
    }
    return this.api(`/issues/${issueId}/comments`, {
      method: "POST",
      body: JSON.stringify({ body, clientRequestId: crypto.randomUUID(), ...(attachmentIds.length ? { attachmentIds } : {}) }),
    });
  }

  // ---- live events: chỉ dùng như tín hiệu "có thay đổi" để refresh sớm; polling vẫn là nguồn chính ----
  onLiveEvent(fn) {
    this.listeners.push(fn);
  }

  connectLive() {
    if (this.closed || this.ws || typeof WebSocket === "undefined" || !this.companyId) return;
    const wsUrl = this.baseUrl.replace(/^http/, "ws") + `/api/companies/${this.companyId}/events/ws`;
    let ws;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.wsRetry = 0;
    };
    ws.onmessage = () => {
      for (const fn of this.listeners) fn();
    };
    ws.onclose = () => {
      this.ws = null;
      if (this.closed) return;
      const delay = Math.min(60000, 2000 * 2 ** this.wsRetry++);
      setTimeout(() => this.connectLive(), delay);
    };
    ws.onerror = () => {};
  }

  close() {
    this.closed = true;
    this.ws?.close();
  }
}
