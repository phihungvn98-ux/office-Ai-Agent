---
name: meeting-minutes
description: Cách chủ trì một buổi họp CÓ HỘI THOẠI của AI Office (daily standup, weekly review) — mở họp, mời từng nhân viên phát biểu ngay trên task họp, đọc cả ý kiến chủ văn phòng chen vào, rồi viết biên bản tiếng Việt và tạo action item. Dùng khi được giao task họp.
---

# Họp văn phòng (có hội thoại)

Buổi họp diễn ra **trên chính task họp** (task do lịch định kỳ tạo). Mọi người "nói" bằng comment trên task đó. Chủ văn phòng xem trực tiếp trong văn phòng pixel (kênh **🗣 Phòng họp**) và có thể chen ý kiến bằng comment.

Mỗi lần được đánh thức trên task họp, xác định **bước** dựa vào các task con có tiêu đề bắt đầu bằng `Phát biểu họp`:

| Tình trạng task con "Phát biểu họp …" | Bước |
|---|---|
| Chưa có | **1 — Mở họp** |
| Có, còn cái chưa xong | **2 — Đang chờ phát biểu** |
| Có, tất cả `done`/`cancelled` | **3 — Tổng kết** |

`GET /api/companies/{companyId}/issues?parentId={taskHọpId}` để xem task con.

## Bước 1 — Mở họp

1. Gọi `office_status` với `state: "meeting"`, `message: "Chủ trì <tên buổi họp>"`.
2. Thu thập nhanh (không đọc sâu):
   - `GET /api/companies/{companyId}/dashboard`, `GET /api/companies/{companyId}/agents`
   - `GET /api/companies/{companyId}/issues?status=in_progress,blocked,in_review`
   - `STATUS.md` của từng dự án; weekly thêm `costs/summary` và `workspaces/_office/jobs/reports/` tuần này.
3. Comment **chương trình họp** lên task họp (≤ 10 dòng): mục tiêu buổi họp, 2–4 điểm cần bàn (deadline gần, việc bị chặn, proposal chờ duyệt, góp ý cho Kỹ sư), mời từng người.
4. Mời phát biểu — với **mỗi nhân viên đang hoạt động** (bỏ qua người `paused`/lỗi; luôn mời `pm`, `job-hunter`, `engineer`, `assistant` nếu đang hoạt động), tạo task con:
   ```json
   POST /api/companies/{companyId}/issues
   {
     "title": "Phát biểu họp <standup|weekly> <DD/MM>",
     "parentId": "<task họp>",
     "assigneeAgentId": "<người dự>",
     "projectId": "<dự án của task họp>",
     "status": "todo",
     "priority": "high",
     "description": "Phát biểu ngắn tại buổi họp <tên> (task cha <IDENTIFIER>).\n\n1. Đọc chương trình họp và các phát biểu trước trên task cha.\n2. Comment LÊN TASK CHA (không phải task này), tối đa 8 dòng, theo mẫu:\n   **<Tên bạn>** — Đã xong: … · Đang làm: … · Vướng/cần chủ văn phòng: … · Đề xuất: …\n   (Kỹ sư: đã sửa gì, nhánh chờ duyệt, góp ý nhận được, đề xuất cải tiến. Trợ lý: email quan trọng từ lần họp trước, việc đã chuyển ai.)\n3. Đánh dấu task này `done`. Không làm việc khác trong lượt này."
   }
   ```
5. Đặt task họp `blocked` với `blockedByIssueIds` = các task con vừa tạo (Paperclip sẽ đánh thức bạn khi chúng xong), comment "Đang chờ mọi người phát biểu", rồi **kết thúc lượt**.

## Bước 2 — Đang chờ phát biểu

Bạn bị đánh thức vì có comment mới (thường là chủ văn phòng chen ý kiến):
- Nếu chủ văn phòng hỏi/ yêu cầu bạn → trả lời ngắn (≤ 4 dòng) bằng comment trên task họp.
- Không lặp lại chương trình họp, không tổng kết sớm. Kết thúc lượt.
- Nếu một người dự đã `paused`/lỗi và task con của họ chưa xong → huỷ task con đó (`cancelled`, ghi lý do) để buổi họp không bị treo.

## Bước 3 — Tổng kết

1. Đọc **toàn bộ** comment trên task họp theo thứ tự (`GET /api/issues/{id}/comments?order=asc`) — gồm phát biểu của mọi người **và ý kiến chủ văn phòng**.
2. (Tuỳ chọn, weekly nên làm) `ask_model` với GPT-6: đưa bản tóm tắt, hỏi "rủi ro nào đang bị bỏ qua?".
3. Viết biên bản `workspaces/_office/meetings/<YYYY-MM-DD>-<standup|weekly>.md`:

```markdown
# <Daily standup | Weekly review> — <YYYY-MM-DD>
Chủ trì: Chánh văn phòng · Dự: <danh sách người đã phát biểu> · Chủ văn phòng: <có/không chen ý kiến>

## Tổng quan
- Dự án đang chạy: n (🟢 a · 🟡 b · 🔴 c)
- Task: x đang làm · y bị chặn · z xong từ lần họp trước
- Job: quét n · đề xuất m proposal · chờ duyệt k

## Phát biểu
- **PM**: …
- **Săn job**: …
- **Kỹ sư**: đã sửa … · nhánh chờ duyệt … · đề xuất …

## Ý kiến chủ văn phòng
- … (ghi đúng ý, kèm việc phải làm)

## Quyết định cần chủ văn phòng
- [ ] …

## Action items
| # | Việc | Người phụ trách | Hạn |
```

4. Mỗi action item → task (assignee, `parentId` = task họp). Góp ý về công cụ/hệ thống → task cho `engineer` trong dự án "Phát triển văn phòng".
5. "Quyết định cần chủ văn phòng" → **một** `request_confirmation` (hoặc `ask_user_questions` nếu cần chọn) trên task họp.
6. Comment kết thúc (≤ 6 dòng + link biên bản), cập nhật `workspaces/_office/STATUS.md`, đặt task họp `done` (hoặc `in_review` nếu đang chờ quyết định), gọi `office_status` với `state: "idle"`.

## Giới hạn để tiết kiệm quota
- Mỗi phát biểu ≤ 8 dòng; chương trình họp ≤ 10 dòng; biên bản standup ≤ 40 dòng, weekly ≤ 100 dòng.
- Standup chỉ bàn việc thay đổi từ lần họp trước. Không ai đọc lại toàn bộ dự án trong buổi họp.
