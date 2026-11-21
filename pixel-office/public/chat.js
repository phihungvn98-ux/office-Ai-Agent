// Tab "Trò chuyện": chat với từng nhân viên (Agent Chat của Paperclip) + kênh "Phòng họp" (hội thoại trên task họp).
// Gửi được ảnh: dán (Ctrl+V), kéo-thả, hoặc chọn file.

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_IMAGES = 5;
const MAX_BYTES = 10 * 1024 * 1024;
const MEETING = "meeting";

// Markdown tối giản: **đậm**, `code`, link, xuống dòng. Escape trước, nên an toàn.
function md(text) {
  return esc(text)
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
    .replace(/\n/g, "<br>");
}

const timeOf = (iso) => new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });

export function createChat({ root, getState, makeAvatar, toast, onAgentLine }) {
  root.innerHTML = `
    <div class="chat">
      <div class="chat-channels" role="tablist" aria-label="Chọn người để trò chuyện"></div>
      <div class="chat-log" aria-live="polite"></div>
      <form class="chat-compose">
        <div class="chat-previews"></div>
        <textarea rows="2" aria-label="Tin nhắn"></textarea>
        <div class="chat-actions">
          <label class="btn ghost chat-file" title="Chọn ảnh">📎 Ảnh<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden></label>
          <span class="chat-hint">Ctrl+V để dán ảnh · Enter gửi · Shift+Enter xuống dòng</span>
          <button class="btn" type="submit">Gửi</button>
        </div>
      </form>
      <div class="chat-drop" hidden>Thả ảnh vào đây</div>
    </div>
    <div class="lightbox" hidden><img alt=""></div>`;

  const els = {
    channels: $(".chat-channels", root),
    log: $(".chat-log", root),
    form: $(".chat-compose", root),
    text: $("textarea", root),
    file: $("input[type=file]", root),
    previews: $(".chat-previews", root),
    send: $("button[type=submit]", root),
    drop: $(".chat-drop", root),
    chat: $(".chat", root),
    lightbox: $(".lightbox", root),
  };

  let channel = null; // agentId hoặc "meeting"
  let pending = []; // ảnh chờ gửi: {name,type,size,dataUrl}
  let shown = new Set(); // id tin đã hiển thị trong kênh hiện tại
  let loadedChannel = null;
  let sending = false;
  let busy = false;

  const agents = () => getState()?.agents || [];
  const agentById = (id) => agents().find((a) => a.id === id);
  const meetingIssue = () => getState()?.meeting?.issueId || null;

  function defaultChannel() {
    const list = agents();
    return (list.find((a) => a.slug === "engineer") || list[0])?.id || null;
  }

  function renderChannels() {
    const list = [...agents()].sort((a, b) => (a.slug === "engineer" ? -1 : b.slug === "engineer" ? 1 : 0));
    if (!channel || (channel !== MEETING && !agentById(channel)) || (channel === MEETING && !meetingIssue())) channel = defaultChannel();
    els.channels.innerHTML = "";
    if (meetingIssue()) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip-btn meeting" + (channel === MEETING ? " on" : "");
      b.setAttribute("aria-pressed", channel === MEETING);
      b.textContent = "🗣 Phòng họp";
      b.onclick = () => open(MEETING);
      els.channels.appendChild(b);
    }
    for (const a of list) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip-btn" + (channel === a.id ? " on" : "");
      b.setAttribute("aria-pressed", channel === a.id);
      b.title = `${a.name} — ${a.title}`;
      b.appendChild(makeAvatar(a, 1));
      b.append(a.name);
      b.onclick = () => open(a.id);
      els.channels.appendChild(b);
    }
    const who = channel === MEETING ? "phòng họp" : agentById(channel)?.name || "…";
    els.text.placeholder = channel === MEETING ? "Chen ý kiến vào buổi họp…" : `Nhắn cho ${who}…`;
  }

  function messageEl(m) {
    const div = document.createElement("div");
    const mine = m.author === "user";
    div.className = `msg-row ${mine ? "mine" : "theirs"}`;
    div.dataset.id = m.id;
    const a = m.agentId ? agentById(m.agentId) : null;
    const name = mine ? "Bạn" : a?.name || (m.author === "system" ? "Hệ thống" : "Nhân viên");
    const imgs = (m.images || [])
      .map((i) => `<a class="msg-img" href="${esc(i.url)}" data-full="${esc(i.url)}"><img src="${esc(i.url)}" alt="${esc(i.name)}" loading="lazy"></a>`)
      .join("");
    const files = (m.files || []).map((f) => `<a class="msg-file" href="${esc(f.url)}" target="_blank" rel="noopener">📄 ${esc(f.name)}</a>`).join("");
    div.innerHTML = `
      <div class="msg-av"></div>
      <div class="msg-bubble">
        <div class="msg-meta"><strong>${esc(name)}</strong> · ${timeOf(m.createdAt)}</div>
        ${m.body && !/^\(\d* ?ảnh\)$/.test(m.body) ? `<div class="msg-text">${md(m.body)}</div>` : ""}
        ${imgs ? `<div class="msg-imgs">${imgs}</div>` : ""}${files}
      </div>`;
    if (a) div.querySelector(".msg-av").appendChild(makeAvatar(a, 1));
    return div;
  }

  async function load({ force = false } = {}) {
    if (!channel || busy) return;
    const target = channel;
    const url = target === MEETING ? `api/thread/${meetingIssue()}` : `api/chat/${target}`;
    if (target === MEETING && !meetingIssue()) return;
    busy = true;
    try {
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      if (target !== channel) return; // người dùng đã chuyển kênh
      const fresh = loadedChannel !== target || force;
      if (fresh) {
        els.log.innerHTML = "";
        shown = new Set();
        loadedChannel = target;
      }
      const atBottom = els.log.scrollHeight - els.log.scrollTop - els.log.clientHeight < 60;
      for (const m of data.messages || []) {
        if (shown.has(m.id)) continue;
        shown.add(m.id);
        els.log.appendChild(messageEl(m));
        if (!fresh && m.author === "agent" && m.agentId) onAgentLine(m.agentId, m.body);
      }
      if (!els.log.children.length) els.log.innerHTML = `<p class="empty">Chưa có tin nhắn. Hãy chào một câu!</p>`;
      if (fresh || atBottom) els.log.scrollTop = els.log.scrollHeight;
    } catch (err) {
      if (loadedChannel !== target) els.log.innerHTML = `<p class="empty warn">Không tải được hội thoại: ${esc(err.message)}</p>`;
    } finally {
      busy = false;
    }
  }

  function open(id) {
    if (id && id !== channel) {
      channel = id;
      loadedChannel = null;
      els.log.innerHTML = `<p class="empty">Đang tải…</p>`;
    }
    renderChannels();
    load();
    els.text.focus({ preventScroll: true });
  }

  // ---- ảnh chờ gửi ----
  function addFiles(files) {
    for (const f of files) {
      if (!IMAGE_TYPES.includes(f.type)) {
        toast(`"${f.name}": chỉ gửi được ảnh PNG, JPEG, WebP, GIF`, true);
        continue;
      }
      if (f.size > MAX_BYTES) {
        toast(`"${f.name}" lớn hơn 10 MB`, true);
        continue;
      }
      if (pending.length >= MAX_IMAGES) {
        toast(`Tối đa ${MAX_IMAGES} ảnh mỗi tin`, true);
        break;
      }
      const item = { name: f.name || "anh.png", type: f.type, size: f.size, dataUrl: null };
      pending.push(item);
      const r = new FileReader();
      r.onload = () => {
        item.dataUrl = r.result;
        renderPreviews();
      };
      r.readAsDataURL(f);
    }
    renderPreviews();
  }

  function renderPreviews() {
    els.previews.innerHTML = "";
    pending.forEach((p, i) => {
      const d = document.createElement("div");
      d.className = "preview";
      d.innerHTML = p.dataUrl ? `<img src="${p.dataUrl}" alt="${esc(p.name)}">` : `<span>…</span>`;
      const x = document.createElement("button");
      x.type = "button";
      x.className = "preview-x";
      x.setAttribute("aria-label", `Bỏ ảnh ${p.name}`);
      x.textContent = "×";
      x.onclick = () => {
        pending.splice(i, 1);
        renderPreviews();
      };
      d.appendChild(x);
      els.previews.appendChild(d);
    });
  }

  async function submit() {
    if (sending || !channel) return;
    const body = els.text.value.trim();
    if (!body && !pending.length) return;
    if (pending.some((p) => !p.dataUrl)) return toast("Ảnh đang được đọc, thử lại sau giây lát", true);
    sending = true;
    els.send.disabled = true;
    els.send.textContent = "Đang gửi…";
    const url = channel === MEETING ? `api/thread/${meetingIssue()}` : `api/chat/${channel}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body, images: pending.map((p) => ({ name: p.name, type: p.type, data: p.dataUrl })) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      els.text.value = "";
      pending = [];
      renderPreviews();
      await load();
      els.log.scrollTop = els.log.scrollHeight;
    } catch (err) {
      toast(`Gửi lỗi: ${err.message}`, true);
    } finally {
      sending = false;
      els.send.disabled = false;
      els.send.textContent = "Gửi";
    }
  }

  els.form.addEventListener("submit", (e) => {
    e.preventDefault();
    submit();
  });
  els.text.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  });
  els.text.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.items || [])].filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter(Boolean);
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  });
  els.file.addEventListener("change", () => {
    addFiles([...els.file.files]);
    els.file.value = "";
  });
  let dragDepth = 0;
  els.chat.addEventListener("dragenter", (e) => {
    if (![...(e.dataTransfer?.types || [])].includes("Files")) return;
    dragDepth++;
    els.drop.hidden = false;
  });
  els.chat.addEventListener("dragleave", () => {
    if (--dragDepth <= 0) {
      dragDepth = 0;
      els.drop.hidden = true;
    }
  });
  els.chat.addEventListener("dragover", (e) => e.preventDefault());
  els.chat.addEventListener("drop", (e) => {
    e.preventDefault();
    dragDepth = 0;
    els.drop.hidden = true;
    addFiles([...(e.dataTransfer?.files || [])]);
  });
  els.log.addEventListener("click", (e) => {
    const a = e.target.closest(".msg-img");
    if (!a) return;
    e.preventDefault();
    els.lightbox.querySelector("img").src = a.dataset.full;
    els.lightbox.hidden = false;
  });
  els.lightbox.addEventListener("click", () => (els.lightbox.hidden = true));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") els.lightbox.hidden = true;
  });

  // Cập nhật định kỳ khi tab đang mở.
  setInterval(() => {
    if (!root.hidden && document.visibilityState === "visible") load();
  }, 3000);

  // Phòng họp: dù không mở tab, vẫn lấy phát biểu mới nhất để hiện bong bóng trên đầu nhân vật.
  let meetingSeen = new Set();
  let meetingId = null;
  setInterval(async () => {
    const id = meetingIssue();
    if (!id || document.visibilityState !== "visible") return;
    if (id !== meetingId) {
      meetingId = id;
      meetingSeen = new Set();
    }
    try {
      const data = await (await fetch(`api/thread/${id}`)).json();
      const fresh = (data.messages || []).filter((m) => !meetingSeen.has(m.id));
      for (const m of fresh) meetingSeen.add(m.id);
      const latest = new Map();
      for (const m of data.messages || []) if (m.agentId) latest.set(m.agentId, m);
      for (const [agentId, m] of latest) if (Date.now() - Date.parse(m.createdAt) < 15 * 60 * 1000) onAgentLine(agentId, m.body, 90);
    } catch {}
  }, 5000);

  return {
    render: renderChannels,
    open,
    onShown() {
      renderChannels();
      load();
    },
  };
}
