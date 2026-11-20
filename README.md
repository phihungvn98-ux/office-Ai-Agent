# AI Office — văn phòng AI agent

Một "văn phòng" gồm các nhân viên AI làm việc cho bạn: quản lý dự án khách hàng đang chạy, săn job freelance, họp và báo cáo định kỳ. Văn phòng có dashboard **Pixel Office** để xem ai đang làm gì, tiến độ tới đâu. Các phòng ban marketing, SEO, sale, video AI sẽ được thêm dần.

```
                ┌──────────────────────────── Bạn ────────────────────────────┐
                │  Pixel Office (xem, điều khiển)        Paperclip UI (duyệt) │
                └──────────────┬───────────────────────────────┬──────────────┘
                               │ REST + live events            │
                        ┌──────▼───────────────────────────────▼──────┐
                        │  Paperclip — "công ty": sơ đồ tổ chức, task, │
                        │  lịch họp (routine), duyệt, ngân sách, log   │
                        └──────┬───────────────┬───────────────┬──────┘
                     heartbeat │               │               │
                  ┌────────────▼─┐   ┌─────────▼────┐   ┌──────▼───────┐
                  │ Chánh VP     │   │ PM dự án     │   │ Săn job      │  ← Claude Code CLI
                  │ (họp, điều   │   │ (STATUS.md,  │   │ (chấm điểm,  │    (gói Pro/Max)
                  │  phối)       │   │  task, nháp) │   │  proposal)   │
                  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘
                         └──── MCP "office" ┴──────────────────┘
                              │ ask_model        │ jobs_fetch        │ office_status
                         ┌────▼─────┐      ┌─────▼──────────┐   ┌────▼─────────┐
                         │ 9Router  │      │ Freelancer API │   │ Pixel Office │
                         │ GPT-6... │      │ RSS · n8n inbox│   └──────────────┘
                         └──────────┘      └────────────────┘
       Context riêng từng dự án: workspaces/<dự-án>/{CLAUDE.md, STATUS.md, DECISIONS.md}
```

| Thành phần | Vai trò |
|---|---|
| [Paperclip](https://github.com/paperclipai/paperclip) (MIT) | Lõi "công ty": nhân viên, task, lịch định kỳ, duyệt, chi phí, lịch sử chạy |
| Claude Code CLI | "Bộ não" của từng nhân viên, đăng nhập bằng gói Claude Pro/Max của bạn |
| `company/` | Hồ sơ văn phòng (nhân viên, skill, dự án, lịch họp) theo định dạng company package. Paperclip import thẳng thư mục này |
| `office-mcp/` | Công cụ cho nhân viên: `ask_model` (9Router → GPT-6...), `jobs_fetch`, `jobs_mark_seen`, `office_status` |
| `pixel-office/` | Dashboard văn phòng pixel: nhân vật, phòng họp, tiến độ dự án, hoạt động và cài đặt |
| `workspaces/` | Mỗi dự án một thư mục, là context riêng của dự án đó |
| `deploy/` | Cài VPS (systemd, Caddy HTTPS), n8n (email job alert → văn phòng) |

---

## 1. Cài trên máy cá nhân

**Cần có:** Node.js ≥ 24.11, Git, Claude Code CLI đã đăng nhập gói Pro/Max, và 9Router đang chạy.
> Trên Windows, nên chạy Paperclip trong **WSL2 (Ubuntu)**. Pixel Office chạy được cả trên Windows thường.

```bash
git clone <repo-cua-ban> ai-office
```

```bash
cd ai-office && npm install
```

```bash
cp .env.example .env
```

Mở `.env` và điền `NINEROUTER_URL`, `NINEROUTER_API_KEY`, `NINEROUTER_DEFAULT_MODEL` (tên model GPT-6 đúng như 9Router liệt kê). `NINEROUTER_API_STYLE` chọn kiểu API: `auto` (mặc định: thử `/responses` trước, lỗi thì quay về `/chat/completions`), `responses` hoặc `chat`.

```bash
claude
```
Gõ `/login`, đăng nhập bằng tài khoản Pro/Max, rồi `/exit`.

```bash
npm run paperclip:setup
```
Lệnh này khởi tạo Paperclip (lần đầu) và mở http://localhost:3100. Từ lần sau chỉ cần `npm run paperclip`.

Mở **terminal khác** và chạy:

```bash
npm run bootstrap
```
Lệnh này import văn phòng vào Paperclip, gán thư mục làm việc và MCP cho từng nhân viên, rồi bật họ lên.

```bash
npm run office
```
Pixel Office chạy tại → http://localhost:3200

```bash
npm run doctor
```
Lệnh này kiểm tra toàn bộ: Node, Claude CLI, Paperclip, 9Router và Pixel Office.

Muốn xem dashboard trước khi có dữ liệu thật thì chạy `npm run office:demo`.

### Việc cần làm ngay sau khi cài
1. Điền **`workspaces/_office/profile.md`** (hồ sơ năng lực) và **`jobs/criteria.md`** (tiêu chí nhận job). Agent săn job dựa vào 2 file này.
2. Chỉnh từ khoá tìm job trong **`workspaces/_office/jobs/sources.json`**.
3. Thêm từng dự án khách hàng đang chạy:
   ```bash
   npm run new-project -- shop-abc --name "Website Shop ABC" --client "ABC Store" --deadline 2026-12-20
   ```
   Sau đó điền `workspaces/shop-abc/CLAUDE.md`. PM sẽ tự nhận task "Khởi tạo dự án": chia việc thành task và viết STATUS.md đầu tiên.

---

## 2. Dùng hằng ngày

| Bạn muốn… | Làm thế nào |
|---|---|
| Xem ai đang làm gì, tiến độ | **Pixel Office**. Nhân vật ngồi gõ phím ở bàn khi làm việc, vào phòng họp khi họp, ra sofa khi rảnh. Bấm vào nhân vật để xem chi tiết |
| Giao việc | Paperclip → tạo task, chọn người (PM / Chánh văn phòng / Săn job), chọn dự án. Agent tự thức dậy khi được giao |
| Duyệt proposal / email gửi khách | Paperclip → hộp duyệt (Pixel Office › Hoạt động hiển thị số việc chờ duyệt). Bạn tự gửi đi |
| Họp ngay | Pixel Office › Cài đặt › "Họp sáng" › **Chạy ngay** |
| Tạm dừng / đổi model / bật tự thức dậy | Pixel Office › Cài đặt |
| Xem biên bản họp | `workspaces/_office/meetings/` |
| Xem job & proposal nháp | `workspaces/_office/jobs/reports/` và `jobs/proposals/` |

**Lịch mặc định** (giờ Việt Nam, sửa trong Paperclip › Routines hoặc `company/.paperclip.yaml`):
- 07:20 · 13:20 · 19:20: Săn job quét job mới
- 07:40 · 16:40 (T2–T7): PM rà soát các dự án khách hàng
- 08:05 (T2–T7): Họp sáng; 09:10 thứ Hai: Review tuần

---

## 3. Tối ưu context cho từng dự án

- Mỗi dự án có một thư mục riêng. Khi agent làm task của dự án nào, nó **chạy bên trong thư mục đó** (project workspace của Paperclip), nên `CLAUDE.md` của dự án được nạp tự động. Agent không đọc sang dự án khác.
- `CLAUDE.md` chứa bối cảnh cố định, ít thay đổi. `STATUS.md` được **ghi đè** sau mỗi lượt (tối đa ~60 dòng), nên lượt sau chỉ cần đọc bản tóm tắt này thay vì cả lịch sử. `DECISIONS.md` chỉ thêm dòng mới.
- Skill (quy trình) chỉ được nạp khi cần. Việc nghiên cứu dài giao cho subagent hoặc `ask_model`.
- Buổi họp chỉ đọc `STATUS.md` của từng dự án, không đọc sâu hơn.

## 4. Tiết kiệm quota Claude Pro/Max

- Nhân viên **không chạy liên tục**: họ chỉ thức dậy theo lịch hoặc khi được giao việc ("tự thức dậy" mặc định tắt).
- Model mặc định: Chánh VP và PM dùng Sonnet, Săn job dùng Haiku. Chỉ chuyển sang Opus khi cần lập kế hoạch lớn (Pixel Office › Cài đặt).
- Việc hàng loạt (lọc job, tóm tắt, viết nhiều phương án nháp) được giao cho **GPT-6 qua 9Router** bằng `ask_model`.
- Khi Claude hết quota, Paperclip ghi nhận lỗi quota và lùi lịch thử lại thay vì chạy dồn. Lịch được rải ra trong ngày để tránh dồn vào cùng một khung 5 giờ.
- **Không** nối gói Claude hay **Antigravity** vào 9Router: dùng gói đăng ký qua công cụ bên thứ ba có rủi ro bị khoá tài khoản. 9Router chỉ chứa các provider dùng API key (GPT-6, Gemini API...).

## 5. Săn job — nguồn hợp lệ

`workspaces/_office/jobs/sources.json` có 3 loại nguồn:
- `freelancer`: API công khai của Freelancer.com (tìm project đang mở, không cần đăng nhập).
- `inbox`: job do **n8n** đọc từ email job alert (Upwork/Fiverr gửi về Gmail), hoặc do bạn tự thả file JSON vào `jobs/inbox/`.
- `rss`: chỉ dùng feed mà nền tảng cho phép.

Agent **không** đăng nhập, không scrape và không tự gửi proposal. Upwork cấm việc này, và vi phạm có thể làm khoá tài khoản. Mọi proposal chỉ là nháp, chờ bạn duyệt rồi tự gửi.

**Cài n8n đọc email job alert:**
```bash
docker compose -f deploy/docker-compose.n8n.yml up -d
```
Mở http://localhost:5678 → Import workflow `deploy/n8n/job-alerts-to-inbox.json` → điền thông tin IMAP (Gmail cần App Password) → bật workflow.

## 6. Triển khai lên VPS (chạy 24/7)

VPS Ubuntu 22.04/24.04, khuyến nghị ≥ 2 vCPU / 4 GB RAM. Trỏ 2 domain con về VPS, ví dụ `paperclip.domain.com` và `office.domain.com`.

```bash
git clone <repo-cua-ban> ~/ai-office && cd ~/ai-office && bash deploy/setup-ubuntu.sh
```

Script cài Node 24, Claude Code, Caddy (HTTPS), dịch vụ systemd, backup hằng đêm và tường lửa, rồi in ra 5 bước bạn cần tự làm: đăng nhập Claude, khởi tạo Paperclip ở chế độ có đăng nhập, Caddyfile, API key cho Pixel Office, bootstrap.

9Router cũng cần chạy trên VPS (hoặc bạn trỏ `NINEROUTER_URL` tới nơi đang chạy 9Router).

**Máy cá nhân ↔ VPS:** chỉ để **một** nơi chạy văn phòng thật (khuyến nghị VPS). Nếu cùng một company chạy ở hai nơi, agent sẽ làm trùng việc. Máy cá nhân dùng để sửa `company/` (nhân viên, skill), test bằng `npm run office:demo`, rồi `git push`. Trên VPS thì `git pull` và cập nhật (xem mục 7). Dữ liệu dự án (`workspaces/`) được backup hằng đêm vào `~/ai-office-backups`.

## 7. Mở rộng văn phòng (thêm phòng ban)

Ví dụ thêm phòng **Marketing/SEO**:
1. Tạo `company/agents/seo/AGENTS.md` (vai trò, quy trình, luật), `reportsTo: manager`, khai báo các skill cần dùng.
2. Tạo skill trong `company/skills/<ten>/SKILL.md` (ví dụ `seo-audit`, `content-calendar`).
3. Thêm cấu hình vào `company/.paperclip.yaml` mục `agents.seo`. Cách nhanh nhất là chép khối `pm` rồi sửa: **giữ `type: claude_local` + `config.engine: cli`** (engine mặc định ACP không nạp MCP `office`), đổi `metadata.officeSlug: seo`, `sprite: designer`, chọn model. Lưu ý: không viết comment ở cuối dòng giá trị.
   Lịch định kỳ cho phòng ban mới thì tạo trong Paperclip › Routines.
4. Import phần mới vào văn phòng đang chạy (không ghi đè những gì đã có), rồi gán workspace/MCP:
   ```bash
   npm run sync
   ```
   Hướng dẫn của nhân viên **đã có** thì sửa trực tiếp trong Paperclip (Agent › Instructions), sau đó chép lại vào `company/` để lưu trong git.
5. Nếu cần API mới (ví dụ tạo video AI), thêm tool vào `office-mcp/server.mjs` (mẫu: `ask_model`) và khai báo key trong `.env`.

Sprite có sẵn cho Pixel Office: `boss`, `pm`, `hunter`, `marketer`, `designer`, `dev`, `qa`, `staff`.

## 8. Cấu trúc thư mục

```
ai-office/
├── company/                 # Company package (import vào Paperclip)
│   ├── COMPANY.md
│   ├── agents/{manager,pm,job-hunter}/AGENTS.md
│   ├── skills/{office-context,meeting-minutes,job-scoring,proposal-writing,ask-other-models}/SKILL.md
│   ├── projects/office-ops/  # dự án nội bộ + 4 task định kỳ (họp, review tuần, quét job, rà soát dự án)
│   └── .paperclip.yaml      # model, lịch (cron, giờ VN), metadata sprite
├── office-mcp/              # MCP server "office" (+ test)
├── pixel-office/            # dashboard (server Node không phụ thuộc thư viện ngoài, canvas pixel art tự vẽ) (+ test)
├── workspaces/
│   ├── _office/             # họp, săn job, hồ sơ năng lực
│   ├── _template/           # mẫu cho dự án mới
│   └── <du-an>/             # mỗi dự án khách hàng một thư mục
├── scripts/office.mjs       # bootstrap · new-project · status · doctor
├── scripts/backup.sh
└── deploy/                  # VPS: setup-ubuntu.sh, systemd, Caddyfile, n8n
```

## 9. Xử lý sự cố

| Hiện tượng | Cách xử lý |
|---|---|
| Pixel Office báo nhân viên "Lỗi: Chưa sẵn sàng… Authentication failed" | Claude CLI chưa đăng nhập: chạy `claude` → `/login`, rồi Pixel Office › Cài đặt › **Thử lại xác minh** |
| `ask_model` báo "Không kết nối được 9Router" | Kiểm tra 9Router đang chạy, sửa `NINEROUTER_URL` trong `.env`, rồi chạy `npm run doctor` để xem danh sách model |
| Pixel Office "Không kết nối được Paperclip" | Chạy `npm run paperclip`. Trên VPS thì kiểm tra `PAPERCLIP_API_KEY` |
| Không thấy job nào | Chỉnh `jobs/sources.json` (từ khoá), kiểm tra n8n |
| Muốn xem agent đã làm gì | Paperclip › task › run log (có transcript đầy đủ) |

Chạy test: `npm test` (office-mcp và pixel-office).

## Bảo mật
- `.env` (key 9Router, token) không được commit. Repo nên để **private** vì `workspaces/` chứa thông tin khách hàng.
- Không ghi mật khẩu hay API key của khách vào `CLAUDE.md` / `STATUS.md`.
- Trên VPS, Pixel Office được bảo vệ bằng basic auth của Caddy. Agent và n8n gửi dữ liệu bằng `PIXEL_OFFICE_TOKEN`.
