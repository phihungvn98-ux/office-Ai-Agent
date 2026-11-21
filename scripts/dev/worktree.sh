#!/usr/bin/env bash
# Tạo (hoặc dùng lại) một git worktree riêng để Kỹ sư văn phòng sửa code mà không đụng vào văn phòng đang chạy.
#   bash scripts/dev/worktree.sh AIO-12-them-nut-chat
# → nhánh eng/AIO-12-them-nut-chat, thư mục ../ai-office-dev/AIO-12-them-nut-chat (đổi bằng AI_OFFICE_DEV_DIR)
# node_modules được liên kết (symlink) từ repo gốc để khỏi cài lại.
set -euo pipefail

die() { echo "✘ $*" >&2; exit 1; }

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NAME="${1:-}"
NAME="${NAME#eng/}"
[ -n "$NAME" ] || die "Cần tên, ví dụ: bash scripts/dev/worktree.sh AIO-12-them-nut-chat"
[[ "$NAME" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$ ]] || die "Tên chỉ gồm chữ, số, dấu chấm, gạch: '$NAME'"

BRANCH="eng/$NAME"
DEV_DIR="${AI_OFFICE_DEV_DIR:-$(dirname "$ROOT")/ai-office-dev}"
WT="$DEV_DIR/$NAME"
cd "$ROOT"

git rev-parse --verify --quiet main >/dev/null || die "Repo không có nhánh main"

if git worktree list --porcelain | grep -qx "worktree $WT"; then
  echo "• Dùng lại worktree đã có"
else
  mkdir -p "$DEV_DIR"
  if git rev-parse --verify --quiet "$BRANCH" >/dev/null; then
    git worktree add "$WT" "$BRANCH" >/dev/null
  else
    git worktree add -b "$BRANCH" "$WT" main >/dev/null
  fi
  echo "• Đã tạo worktree từ main"
fi

if [ -d "$ROOT/node_modules" ] && [ ! -e "$WT/node_modules" ]; then
  ln -s "$ROOT/node_modules" "$WT/node_modules"
fi

echo "WORKTREE=$WT"
echo "BRANCH=$BRANCH"
echo "→ cd \"$WT\" rồi sửa code, chạy npm test, commit. Xong thì xin duyệt; được duyệt mới chạy scripts/dev/deploy.sh $BRANCH (từ repo gốc)."
