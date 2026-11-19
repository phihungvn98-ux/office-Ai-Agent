#!/usr/bin/env bash
# Cài AI Office lên VPS Ubuntu 22.04/24.04 (chạy bằng user thường có sudo, KHÔNG chạy bằng root).
#   git clone <repo-cua-ban> ~/ai-office && cd ~/ai-office && bash deploy/setup-ubuntu.sh
# Script chỉ cài phần mềm và dịch vụ; các bước cần bạn đăng nhập (Claude, Paperclip) được in ra ở cuối.
set -euo pipefail

if [ "$(id -u)" = "0" ]; then echo "Hãy chạy bằng user thường (Postgres nhúng của Paperclip không chạy dưới root)."; exit 1; fi
REPO="$(cd "$(dirname "$0")/.." && pwd)"
ME="$(id -un)"
cd "$REPO"

echo "== 1/5 Node.js 24, git, công cụ cơ bản"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
sudo apt-get install -y git python3 ufw debian-keyring debian-archive-keyring apt-transport-https curl

echo "== 2/5 Claude Code CLI"
command -v claude >/dev/null || sudo npm install -g @anthropic-ai/claude-code

echo "== 3/5 Caddy (HTTPS reverse proxy)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update && sudo apt-get install -y caddy
fi

echo "== 4/5 Cài thư viện của repo"
npm install
[ -f .env ] || cp .env.example .env
if ! grep -q '^PIXEL_OFFICE_TOKEN=.\+' .env; then
  sed -i "s/^PIXEL_OFFICE_TOKEN=.*/PIXEL_OFFICE_TOKEN=$(openssl rand -hex 24)/" .env
fi

echo "== 5/5 Dịch vụ systemd (paperclip, pixel-office, backup hằng đêm)"
for f in paperclip.service pixel-office.service ai-office-backup.service ai-office-backup.timer; do
  sed -e "s#/home/USER/ai-office#${REPO}#g" -e "s/^User=USER/User=${ME}/" "deploy/systemd/$f" | sudo tee "/etc/systemd/system/$f" >/dev/null
done
sudo sed -i "s#ExecStart=/usr/bin/npx#ExecStart=$(command -v npx)#; s#ExecStart=/usr/bin/node#ExecStart=$(command -v node)#" /etc/systemd/system/paperclip.service /etc/systemd/system/pixel-office.service
sudo systemctl daemon-reload

echo "== Tường lửa: chỉ mở SSH + HTTP/HTTPS"
sudo ufw allow OpenSSH >/dev/null; sudo ufw allow 80,443/tcp >/dev/null; sudo ufw --force enable >/dev/null

cat <<EOF

✅ Đã cài xong phần mềm. Làm tiếp các bước sau (cần bạn thao tác):

 1) Đăng nhập Claude (gói Pro/Max) cho user ${ME}:
      claude        → gõ /login, mở link trên trình duyệt, dán mã. Thoát bằng /exit.

 2) Khởi tạo Paperclip ở chế độ có đăng nhập, đứng sau Caddy:
      npx paperclipai onboard        → chọn "authenticated" → "public",
                                       public URL: https://paperclip.<domain-cua-ban>
      sudo systemctl enable --now paperclip

 3) Cấu hình domain + HTTPS: trỏ DNS paperclip.<domain> và office.<domain> về IP VPS, rồi
      sudo cp deploy/Caddyfile.example /etc/caddy/Caddyfile && sudo nano /etc/caddy/Caddyfile
      caddy hash-password             (dán kết quả vào Caddyfile)
      sudo systemctl reload caddy
    Mở https://paperclip.<domain>, tạo tài khoản admin.

 4) Tạo API key cho Pixel Office và điền .env:
      npx paperclipai connect          (đăng nhập CLI bằng tài khoản admin)
      npx paperclipai token board create --name pixel-office --never-expires
      nano .env    → PAPERCLIP_API_KEY=..., PAPERCLIP_PUBLIC_URL=https://paperclip.<domain>,
                     NINEROUTER_URL / NINEROUTER_API_KEY / NINEROUTER_DEFAULT_MODEL

 5) Dựng văn phòng và bật dashboard:
      npm run bootstrap
      sudo systemctl enable --now pixel-office ai-office-backup.timer
      npm run doctor

EOF
