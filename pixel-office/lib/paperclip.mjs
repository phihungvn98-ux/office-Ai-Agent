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
