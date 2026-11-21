// Test scripts/dev/worktree.sh và deploy.sh trên một repo git tạm (không đụng repo thật).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let tmp, root, devDir, reloads, server, port;

const git = (args, cwd = root) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const sh = (script, args, extraEnv = {}) =>
  spawnSync("bash", [path.join(root, "scripts", "dev", script), ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, AI_OFFICE_DEV_DIR: devDir, GIT_TERMINAL_PROMPT: "0", ...extraEnv },
  });
// Bản bất đồng bộ: để server giả (cùng tiến trình) còn trả lời được lệnh reload trong lúc script chạy.
const shAsync = (script, args) =>
  new Promise((resolve) => {
    const c = spawn("bash", [path.join(root, "scripts", "dev", script), ...args], {
      cwd: root,
      env: { ...process.env, AI_OFFICE_DEV_DIR: devDir, GIT_TERMINAL_PROMPT: "0" },
    });
    let stdout = "", stderr = "";
    c.stdout.on("data", (d) => (stdout += d));
    c.stderr.on("data", (d) => (stderr += d));
    c.on("close", (status) => resolve({ status, stdout, stderr }));
  });
const write = (p, s) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s);
};

before(async () => {
  reloads = [];
  server = http.createServer((req, res) => {
    reloads.push({ url: req.url, auth: req.headers.authorization });
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  port = server.address().port;

  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dev-scripts-"));
  root = path.join(tmp, "ai-office");
  devDir = path.join(tmp, "ai-office-dev");
  fs.mkdirSync(root);
  for (const f of ["worktree.sh", "deploy.sh"]) write(path.join(root, "scripts", "dev", f), fs.readFileSync(path.join(REPO, "scripts", "dev", f)));
  fs.copyFileSync(path.join(REPO, ".gitignore"), path.join(root, ".gitignore"));
  // test "hỏng" khi có file FAIL
  write(path.join(root, "package.json"), JSON.stringify({ name: "t", private: true, scripts: { test: "node -e \"process.exit(require('fs').existsSync('FAIL')?1:0)\"" } }));
  write(path.join(root, "pixel-office", "a.txt"), "v1\n");
  write(path.join(root, "workspaces", "_office", "STATUS.md"), "cũ\n");
  write(path.join(root, ".env"), `PIXEL_OFFICE_URL=http://127.0.0.1:${port}\nPIXEL_OFFICE_TOKEN=tok\n`);
  fs.mkdirSync(path.join(root, "node_modules"));
  git(["init", "-q", "-b", "main"]);
  git(["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"]);
  git(["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", "commit", "-qm", "init"]);
  git(["config", "user.email", "t@t"]);
  git(["config", "user.name", "t"]);
  git(["config", "commit.gpgsign", "false"]);
});

after(() => {
  server?.close();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

test("worktree.sh tạo nhánh eng/… + worktree, symlink node_modules không bị git thấy", () => {
  const r = sh("worktree.sh", ["AIO-1-doi-chu"]);
  assert.equal(r.status, 0, r.stderr);
  const wt = path.join(devDir, "AIO-1-doi-chu");
  assert.match(r.stdout, new RegExp(`WORKTREE=${wt}`));
  assert.match(r.stdout, /BRANCH=eng\/AIO-1-doi-chu/);
  assert.ok(fs.lstatSync(path.join(wt, "node_modules")).isSymbolicLink());
  assert.equal(git(["status", "--porcelain"], wt), "");
  // chạy lại → dùng lại, không lỗi
  assert.equal(sh("worktree.sh", ["eng/AIO-1-doi-chu"]).status, 0);
  // tên xấu bị từ chối
  assert.notEqual(sh("worktree.sh", ["../hack"]).status, 0);
});

test("deploy.sh gộp nhánh, gọi tải lại văn phòng, xoá worktree + nhánh", async () => {
  const wt = path.join(devDir, "AIO-1-doi-chu");
  write(path.join(wt, "pixel-office", "a.txt"), "v2\n");
  git(["add", "-A"], wt);
  git(["commit", "-qm", "đổi chữ"], wt);
  // dữ liệu nhân viên đang thay đổi trên main → vẫn cho gộp
  write(path.join(root, "workspaces", "_office", "STATUS.md"), "mới — chưa commit\n");

  const r = await shAsync("deploy.sh", ["eng/AIO-1-doi-chu"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Triển khai xong/);
  assert.equal(fs.readFileSync(path.join(root, "pixel-office", "a.txt"), "utf8"), "v2\n");
  assert.equal(fs.readFileSync(path.join(root, "workspaces", "_office", "STATUS.md"), "utf8"), "mới — chưa commit\n");
  assert.deepEqual(reloads.at(-1), { url: "/office/api/admin/reload", auth: "Bearer tok" });
  assert.ok(!fs.existsSync(wt));
  assert.equal(git(["branch", "--list", "eng/AIO-1-doi-chu"]), "");
  assert.match(git(["log", "-1", "--format=%s"]), /Gộp eng\/AIO-1-doi-chu/);
});

test("deploy.sh: test hỏng → tự hoàn tác, giữ nguyên dữ liệu workspaces đang sửa", () => {
  const head = git(["rev-parse", "HEAD"]);
  const wt = sh("worktree.sh", ["AIO-2-hong"]).stdout.match(/WORKTREE=(.*)/)[1];
  write(path.join(wt, "FAIL"), "x");
  write(path.join(wt, "pixel-office", "a.txt"), "v3\n");
  git(["add", "-A"], wt);
  git(["commit", "-qm", "làm hỏng"], wt);

  const r = sh("deploy.sh", ["eng/AIO-2-hong"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Test hỏng/);
  assert.equal(git(["rev-parse", "HEAD"]), head);
  assert.ok(!fs.existsSync(path.join(root, "FAIL")));
  assert.equal(fs.readFileSync(path.join(root, "pixel-office", "a.txt"), "utf8"), "v2\n");
  assert.equal(fs.readFileSync(path.join(root, "workspaces", "_office", "STATUS.md"), "utf8"), "mới — chưa commit\n");
  // nhánh vẫn còn để Kỹ sư sửa tiếp
  assert.notEqual(git(["branch", "--list", "eng/AIO-2-hong"]), "");
});

test("deploy.sh từ chối khi main có code chưa commit, hoặc nhánh không phải eng/…", () => {
  write(path.join(root, "pixel-office", "a.txt"), "đang sửa tay\n");
  const r = sh("deploy.sh", ["eng/AIO-2-hong"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /chưa commit/);
  git(["checkout", "--", "pixel-office/a.txt"]);
  assert.notEqual(sh("deploy.sh", ["main"]).status, 0);
  assert.notEqual(sh("deploy.sh", ["eng/khong-ton-tai"]).status, 0);
});
