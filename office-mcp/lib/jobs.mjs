import fs from "node:fs/promises";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import { config } from "./config.mjs";

const SEEN_TTL_DAYS = 60;
const DESC_MAX = 1500;

const paths = () => ({
  sources: path.join(config.jobsDir, "sources.json"),
  seen: path.join(config.jobsDir, "seen.json"),
  inbox: path.join(config.jobsDir, "inbox"),
  inboxDone: path.join(config.jobsDir, "inbox", "processed"),
});

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw new Error(`Không đọc được ${file}: ${err.message}`);
  }
}

const clean = (s) =>
  String(s ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const truncate = (s, n = DESC_MAX) => (s.length > n ? s.slice(0, n) + "…" : s);

export function normalizeJob(raw, platform) {
  const id = String(raw.id ?? raw.url ?? raw.link ?? raw.title);
  return {
    id: id.includes(":") ? id : `${platform}:${id}`,
    platform,
    title: clean(raw.title),
    url: raw.url || raw.link || null,
    description: truncate(clean(raw.description)),
    budget: raw.budget ?? null,
    type: raw.type ?? null,
    skills: raw.skills ?? [],
    posted_at: raw.posted_at ?? null,
    proposals: raw.proposals ?? null,
    client: raw.client ?? null,
  };
}

// ---- Freelancer.com public API (không cần đăng nhập để tìm project đang mở) ----
async function fromFreelancer(src, override) {
  const params = new URLSearchParams({
    query: override.query || src.query || "",
    limit: String(src.limit || 30),
    full_description: "true",
    job_details: "true",
    compact: "true",
    sort_field: "time_updated",
  });
  if (src.min_budget) params.set("min_avg_price", String(src.min_budget));
  const url = `${config.freelancerApiBase}/projects/0.1/projects/active/?${params}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Freelancer API ${res.status}`);
  const data = await res.json();
  return (data?.result?.projects || []).map((p) =>
    normalizeJob(
      {
        id: p.id,
        title: p.title,
        url: p.seo_url ? `https://www.freelancer.com/projects/${p.seo_url}` : null,
        description: p.description || p.preview_description,
        budget: p.budget
          ? `${p.budget.minimum ?? "?"}–${p.budget.maximum ?? "?"} ${p.currency?.code ?? ""}`.trim()
          : null,
        type: p.type ?? null,
        skills: (p.jobs || []).map((j) => j.name),
        posted_at: p.time_submitted ? new Date(p.time_submitted * 1000).toISOString() : null,
        proposals: p.bid_stats?.bid_count ?? null,
      },
      "freelancer",
    ),
  );
}

// ---- RSS/Atom (chỉ dùng feed mà nền tảng cho phép) ----
async function fromRss(src) {
  const res = await fetch(src.url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`RSS ${src.name || src.url} ${res.status}`);
  const xml = await res.text();
  const doc = new XMLParser({ ignoreAttributes: false }).parse(xml);
  const items = [].concat(doc?.rss?.channel?.item || doc?.feed?.entry || []);
  const platform = src.platform || src.name || "rss";
  return items.map((it) =>
    normalizeJob(
      {
        id: it.guid?.["#text"] || it.guid || it.id || it.link?.["@_href"] || it.link,
        title: it.title?.["#text"] ?? it.title,
        url: it.link?.["@_href"] || it.link,
        description: it.description || it.summary?.["#text"] || it.summary || it.content?.["#text"] || "",
        posted_at: it.pubDate || it.updated || null,
      },
      platform,
    ),
  );
}

// ---- Inbox: file JSON do n8n (email alert Upwork/Fiverr...) hoặc chủ văn phòng thả vào ----
async function fromInbox() {
  const { inbox, inboxDone } = paths();
  let files = [];
  try {
    files = (await fs.readdir(inbox)).filter((f) => f.endsWith(".json"));
  } catch (err) {
    if (err.code === "ENOENT") return { jobs: [], files: [] };
    throw err;
  }
  const jobs = [];
  for (const f of files) {
    const data = await readJson(path.join(inbox, f), []);
    for (const raw of [].concat(data)) jobs.push(normalizeJob(raw, raw.platform || "inbox"));
  }
  await fs.mkdir(inboxDone, { recursive: true });
  return { jobs, files: files.map((f) => [path.join(inbox, f), path.join(inboxDone, f)]) };
}

async function loadSeen() {
  const seen = await readJson(paths().seen, {});
  const cutoff = Date.now() - SEEN_TTL_DAYS * 86400000;
  for (const [id, ts] of Object.entries(seen)) if (Date.parse(ts) < cutoff) delete seen[id];
  return seen;
}

export async function fetchJobs({ limit = 40, query, include_seen = false } = {}) {
  const cfg = await readJson(paths().sources, null);
  if (!cfg) throw new Error(`Chưa có ${paths().sources}. Copy từ sources.example.json và chỉnh từ khoá.`);
  const seen = include_seen ? {} : await loadSeen();
  const errors = [];
  const all = [];
  let inboxMoves = [];

  for (const src of cfg.sources || []) {
    if (src.enabled === false) continue;
    try {
      if (src.type === "freelancer") all.push(...(await fromFreelancer(src, { query })));
      else if (src.type === "rss") all.push(...(await fromRss(src)));
      else if (src.type === "inbox") {
        const r = await fromInbox();
        all.push(...r.jobs);
        inboxMoves = r.files;
      } else errors.push(`Nguồn không hỗ trợ: ${src.type}`);
    } catch (err) {
      const why = err.cause?.code || err.cause?.message || err.message;
      errors.push(`${src.name || src.type}: ${err.message === "fetch failed" ? `không kết nối được (${why})` : err.message}`);
    }
  }

  const unique = new Map();
  for (const j of all) if (!seen[j.id] && !unique.has(j.id)) unique.set(j.id, j);
  const jobs = [...unique.values()]
    .sort((a, b) => (Date.parse(b.posted_at) || 0) - (Date.parse(a.posted_at) || 0))
    .slice(0, limit);

  // Inbox đã đọc thì chuyển sang processed/ để không đọc lại.
  for (const [from, to] of inboxMoves) await fs.rename(from, to).catch(() => {});

  return { count: jobs.length, total_found: all.length, errors, jobs };
}

export async function markSeen(ids) {
  const seen = await loadSeen();
  const now = new Date().toISOString();
  for (const id of ids) seen[id] = now;
  await fs.mkdir(config.jobsDir, { recursive: true });
  await fs.writeFile(paths().seen, JSON.stringify(seen, null, 2));
  return { marked: ids.length, total_seen: Object.keys(seen).length };
}
