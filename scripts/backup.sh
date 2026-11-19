#!/usr/bin/env bash
# Backup AI Office: database Paperclip + toàn bộ workspaces (context các dự án). Giữ 14 bản gần nhất.
set -euo pipefail
cd "$(dirname "$0")/.."
DEST="${AI_OFFICE_BACKUP_DIR:-$HOME/ai-office-backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DEST"

echo "→ Backup database Paperclip"
npx paperclipai db:backup >/dev/null 2>&1 && echo "  ok (file .sql.gz trong thư mục backups của Paperclip, ~/.paperclip/...)" || echo "  ! db:backup lỗi — kiểm tra Paperclip"

echo "→ Nén workspaces + cấu hình"
tar -czf "$DEST/ai-office-$STAMP.tar.gz" --exclude='node_modules' workspaces company .env 2>/dev/null || tar -czf "$DEST/ai-office-$STAMP.tar.gz" --exclude='node_modules' workspaces company
echo "  $DEST/ai-office-$STAMP.tar.gz"

ls -1t "$DEST"/ai-office-*.tar.gz 2>/dev/null | tail -n +15 | xargs -r rm -f
echo "Xong."
