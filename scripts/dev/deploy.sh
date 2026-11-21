#!/usr/bin/env bash
# Triển khai một nhánh của Kỹ sư văn phòng vào main — CHỈ chạy sau khi chủ văn phòng đã đồng ý.
#   bash scripts/dev/deploy.sh eng/AIO-12-them-nut-chat
# Các bước: kiểm tra main sạch → gộp (--no-ff) → npm install nếu cần → npm test (hỏng thì tự hoàn tác)
#           → npm run sync nếu company/ đổi → tải lại văn phòng → push GitHub (nếu được) → xoá worktree.
# Không bao giờ khởi động lại Paperclip.
set -euo pipefail

die() { echo "✘ $*" >&2; exit 1; }
step() { echo "• $*"; }

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BRANCH="${1:-}"
[ -n "$BRANCH" ] || die "Cần tên nhánh, ví dụ: bash scripts/dev/deploy.sh eng/AIO-12-them-nut-chat"
case "$BRANCH" in eng/*) ;; *) die "Chỉ triển khai nhánh eng/… (nhận: $BRANCH)";; esac
cd "$ROOT"

# .env cho token/địa chỉ văn phòng (không in ra)
if [ -f .env ]; then set -a; . ./.env; set +a; fi
OFFICE_URL="${PIXEL_OFFICE_URL:-http://localhost:${PIXEL_OFFICE_PORT:-3200}}"

[ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || die "Repo gốc phải đang ở nhánh main (hiện: $(git rev-parse --abbrev-ref HEAD))"
git rev-parse --verify --quiet "$BRANCH" >/dev/null || die "Không có nhánh $BRANCH"

# Chỉ code mới quan trọng; dữ liệu nhân viên trong workspaces/ được phép đang thay đổi.
DIRTY="$(git status --porcelain -- . ':(exclude)workspaces' ':(exclude)office-mcp/mcp.generated.json')"
[ -z "$DIRTY" ] || die "main có thay đổi code chưa commit — không gộp được:
$DIRTY"

AHEAD="$(git rev-list --count "main..$BRANCH")"
[ "$AHEAD" -gt 0 ] || die "Nhánh $BRANCH không có commit mới so với main"

PREV="$(git rev-parse HEAD)"
step "Gộp $BRANCH ($AHEAD commit) vào main"
if ! git merge --no-ff --no-edit -m "Gộp $BRANCH (Kỹ sư văn phòng)" "$BRANCH" >/dev/null; then
  git merge --abort || true
  die "Xung đột khi gộp — sửa xung đột trong nhánh (rebase lên main) rồi xin duyệt lại"
fi
CHANGED="$(git diff --name-only "$PREV" HEAD)"

rollback() {
  echo "✘ $1 → hoàn tác về $(git rev-parse --short "$PREV")" >&2
  git reset --keep "$PREV" >/dev/null
  if echo "$CHANGED" | grep -qE '(^|/)package(-lock)?\.json$'; then npm install --no-audit --no-fund >/dev/null 2>&1 || true; fi
  exit 1
}

if echo "$CHANGED" | grep -qE '(^|/)package(-lock)?\.json$'; then
  step "package.json/lock đổi → npm install"
  npm install --no-audit --no-fund >/dev/null 2>&1 || rollback "npm install lỗi"
fi

step "Chạy npm test trên main"
if ! npm test >/tmp/ai-office-deploy-test.log 2>&1; then
  tail -30 /tmp/ai-office-deploy-test.log >&2
  rollback "Test hỏng sau khi gộp"
fi

if echo "$CHANGED" | grep -q '^company/'; then
  step "company/ đổi → npm run sync (nhân viên/skill mới; không tự bật nhân viên đang tạm dừng)"
  node scripts/office.mjs sync --no-activate || echo "! sync lỗi — chủ văn phòng chạy lại: npm run sync"
fi

if echo "$CHANGED" | grep -q '^pixel-office/'; then
  step "Tải lại cổng/văn phòng pixel"
  AUTH=()
  [ -n "${PIXEL_OFFICE_TOKEN:-}" ] && AUTH=(-H "Authorization: Bearer $PIXEL_OFFICE_TOKEN")
  curl -fsS -m 10 -X POST "${AUTH[@]}" "$OFFICE_URL/office/api/admin/reload" >/dev/null \
    && echo "  ✔ đã gửi lệnh tải lại (văn phòng bật lại sau ~2 giây)" \
    || echo "! Không gọi được reload — chủ văn phòng tắt/bật lại npm start"
fi
if echo "$CHANGED" | grep -qE '^scripts/start\.mjs$|^package\.json$'; then
  echo "! scripts/start.mjs hoặc package.json đổi → cần chủ văn phòng tắt (Ctrl+C) và chạy lại: npm start"
fi
if echo "$CHANGED" | grep -q '^office-mcp/'; then
  echo "• office-mcp đổi → có hiệu lực từ lượt chạy tiếp theo của mỗi nhân viên"
fi

if git remote get-url origin >/dev/null 2>&1; then
  if GIT_TERMINAL_PROMPT=0 timeout 60 git push origin main >/dev/null 2>&1; then
    step "Đã push main lên GitHub"
  else
    echo "! Không push được lên GitHub (chưa đăng nhập git?) — chủ văn phòng tự chạy: git push origin main"
  fi
fi

WT="$(git worktree list --porcelain | awk -v b="refs/heads/$BRANCH" '/^worktree /{w=$2} $0=="branch " b {print w}')"
if [ -n "$WT" ]; then git worktree remove --force "$WT" && step "Đã xoá worktree $WT"; fi
git branch -d "$BRANCH" >/dev/null 2>&1 && step "Đã xoá nhánh $BRANCH" || true

echo "✔ Triển khai xong: $(git log -1 --format='%h %s')"
echo "$CHANGED" | sed 's/^/   /'
