---
name: office-engineering
description: Quy trình của Kỹ sư văn phòng khi sửa hệ thống AI Office — bản đồ repo, làm việc trên worktree/nhánh riêng, chạy test, xin duyệt (human_only), triển khai bằng scripts/dev/deploy.sh, và cách xem ảnh chủ văn phòng gửi trong chat. Dùng mỗi khi nhận yêu cầu sửa/mở rộng văn phòng.
---

# Office Engineering

## Bản đồ repo (thư mục gốc = cwd của bạn)

| Đường dẫn | Là gì | Ghi chú khi sửa |
|---|---|---|
| `company/` | Company package: `agents/*/AGENTS.md`, `skills/*/SKILL.md`, `projects/`, `.paperclip.yaml` | Thêm nhân viên mới → `npm run sync` (deploy.sh tự chạy). Sửa hướng dẫn nhân viên **đã có** → sửa file + cập nhật trong Paperclip (Agent › Instructions) hoặc báo chủ văn phòng. **Không** viết comment cuối dòng giá trị trong `.paperclip.yaml` |
| `office-mcp/` | MCP server `office` (ask_model, jobs_fetch, office_status…) | Có hiệu lực ở lượt chạy sau của nhân viên. Test: `office-mcp/test/` |
| `pixel-office/` | Cổng chung :3200 (Paperclip ở `/`, văn phòng ở `/office/`) + giao diện pixel (`public/`) | Có hiệu lực sau khi deploy.sh gọi reload. Test: `pixel-office/test/` |
| `scripts/` | `office.mjs` (bootstrap/sync/new-project/status/doctor), `start.mjs` (`npm start`), `dev/` (worktree, deploy) | |
| `deploy/` | VPS: systemd, Caddy, n8n | |
| `workspaces/` | **Dữ liệu** của các dự án và văn phòng — không phải code | Không sửa/xoá dữ liệu của người khác |
| `README.md` | Hướng dẫn cho chủ văn phòng (tiếng Việt) | Cập nhật khi đổi cách dùng |

Chuẩn code: Node ≥ 22, ESM (`.mjs`), **không thêm thư viện nếu tự viết được**, giao diện và thông báo bằng tiếng Việt, mọi chức năng mới có test (`node --test`).

## Quy trình một yêu cầu

1. **Hiểu yêu cầu.** Đọc tin nhắn/task. Nếu có ảnh → tải về và xem (mục "Xem ảnh" dưới). Chưa rõ → hỏi lại một lần, gom đủ câu hỏi (dùng `ask_user_questions` hoặc hỏi trong chat).
2. **Báo kế hoạch ngắn** (3–6 dòng): sẽ sửa file nào, ảnh hưởng gì. Việc lớn → tạo task con trong dự án "Phát triển văn phòng".
3. **Tạo worktree:**
   ```bash
   bash scripts/dev/worktree.sh AIO-12-them-nut-chat
   ```
   Script in ra đường dẫn worktree (ví dụ `../ai-office-dev/AIO-12-them-nut-chat`) trên nhánh `eng/AIO-12-them-nut-chat`. **Mọi chỉnh sửa và lệnh chạy đều trong thư mục đó** (`cd` vào trước).
4. **Sửa code + test:** `npm test` trong worktree phải qua hết. Thay đổi giao diện → mô tả rõ thay đổi hiển thị.
5. **Commit** (tiếng Việt, mô tả ngắn gọn): `git add -A && git commit -m "..."`.
6. **Báo cáo & xin duyệt** trên issue đang làm (chat hoặc task):
   - Tóm tắt, `git diff --stat main...HEAD`, kết quả test, rủi ro, cách hoàn tác.
   - Tạo confirmation **chỉ người thật được duyệt**:
     ```bash
     curl -s -X POST "$PAPERCLIP_API_URL/api/issues/$ISSUE_ID/interactions" \
       -H "Authorization: Bearer $PAPERCLIP_API_KEY" -H "X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID" \
       -H 'content-type: application/json' -d '{
         "kind": "request_confirmation",
         "idempotencyKey": "deploy:'"$ISSUE_ID"':eng/AIO-12-them-nut-chat:'"$(git rev-parse --short HEAD)"'",
         "title": "Duyệt triển khai",
         "resolverPolicy": "human_only",
         "continuationPolicy": "wake_assignee_on_accept",
         "payload": {
           "version": 1,
           "prompt": "Gộp nhánh eng/AIO-12-them-nut-chat vào main và tải lại văn phòng?",
           "acceptLabel": "Gộp & tải lại",
           "rejectLabel": "Cần sửa thêm",
           "rejectRequiresReason": true,
           "rejectReasonLabel": "Cần sửa gì?",
           "detailsMarkdown": "<tóm tắt thay đổi, diff --stat, kết quả test>"
         }
       }'
     ```
     **Bắt buộc `"resolverPolicy": "human_only"`** — mặc định Paperclip cho cả agent (kể cả bạn) bấm duyệt. Định dạng đầy đủ: skill `paperclip`. API báo sai trường → sửa theo thông báo lỗi.
   - Đặt issue `in_review` và dừng lượt. **Không tự bấm duyệt.**
7. **Khi được đồng ý** (confirmation accepted, hoặc chủ văn phòng nhắn rõ "ok gộp eng/…"):
   ```bash
   bash scripts/dev/deploy.sh eng/AIO-12-them-nut-chat
   ```
   Chạy từ **thư mục gốc repo** (không phải worktree). Script tự: kiểm tra main sạch, gộp, `npm install` nếu cần, chạy test (hỏng → tự hoàn tác), `npm run sync` nếu `company/` đổi, tải lại văn phòng, push GitHub nếu được, xoá worktree. Dán kết quả cuối vào issue.
8. Bị từ chối hoặc chủ văn phòng muốn sửa thêm → sửa tiếp trong worktree, commit, xin duyệt lại.

## Xem ảnh chủ văn phòng gửi

Ảnh nằm trong attachment của issue (chat hoặc task). Claude không tự thấy ảnh — phải tải về rồi dùng tool **Read** để xem:

```bash
ISSUE_ID="${PAPERCLIP_TASK_ID}"
DIR="/tmp/office-eng/$ISSUE_ID" && mkdir -p "$DIR"
curl -s -H "Authorization: Bearer $PAPERCLIP_API_KEY" "$PAPERCLIP_API_URL/api/issues/$ISSUE_ID/attachments" > "$DIR/list.json"
node -e 'for (const a of JSON.parse(require("fs").readFileSync(process.argv[1]))) console.log(a.id, a.contentType, a.originalFilename || "")' "$DIR/list.json"
# với từng ảnh (id ở cột 1):
curl -s -H "Authorization: Bearer $PAPERCLIP_API_KEY" "$PAPERCLIP_API_URL/api/attachments/<id>/content" -o "$DIR/<id>.png"
```
Sau đó Read `"$DIR/<id>.png"`. Chỉ tải ảnh của tin nhắn đang xử lý (đối chiếu thời gian/ comment).

## Góp ý từ nhân viên khác
Task do nhân viên tạo cho bạn: phân loại (lỗi / thiếu công cụ / cải tiến), ước lượng nhỏ–vừa–lớn. Lỗi chặn công việc → làm trước. Còn lại → đưa vào phần phát biểu ở buổi họp gần nhất để chủ văn phòng chọn ưu tiên.

## Khi nào cần chủ văn phòng tự làm
Khởi động lại Paperclip, sửa `.env`/token, cài phần mềm hệ thống, đăng nhập dịch vụ, nâng cấp Paperclip. Viết hướng dẫn từng lệnh, rõ ràng, để họ copy chạy.
