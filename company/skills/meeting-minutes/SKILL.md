---
name: meeting-minutes
description: Cách tổ chức một buổi họp của AI Office (daily standup, weekly review) — thu thập tình trạng mọi dự án và nhân viên, viết biên bản tiếng Việt, tạo action item thành task. Dùng khi được giao task họp.
---

# Họp văn phòng

Buổi họp là một lượt làm việc của Chánh văn phòng. "Các nhân viên dự họp" bằng dữ liệu họ để lại: STATUS.md, comment, task.

## Chuẩn bị (thu thập dữ liệu)

1. Gọi `office_status` với `state: "meeting"` (dashboard sẽ đưa mọi người vào phòng họp).
2. `GET /api/companies/{companyId}/dashboard` — số task theo trạng thái, task bị treo, chi phí.
3. `GET /api/companies/{companyId}/agents` — trạng thái từng nhân viên.
4. `GET /api/companies/{companyId}/issues?status=in_progress,blocked,in_review` — việc đang chạy.
5. Đọc `STATUS.md` của từng dự án (chỉ file này — không đọc sâu hơn).
6. Với weekly review: thêm `GET /api/companies/{companyId}/costs/summary` và báo cáo job tuần trong `workspaces/_office/jobs/reports/`.
7. (Tuỳ chọn) Gọi `ask_model` với GPT-6 để có **góc nhìn phản biện**: đưa bản tóm tắt tình hình, hỏi "rủi ro nào đang bị bỏ qua?".

## Biên bản

Lưu tại `workspaces/_office/meetings/<YYYY-MM-DD>-<standup|weekly>.md`:

```markdown
# <Daily standup | Weekly review> — <YYYY-MM-DD>
Chủ trì: Chánh văn phòng · Dự: pm, job-hunter

## Tổng quan
- Dự án đang chạy: n (🟢 a · 🟡 b · 🔴 c)
- Task: x đang làm · y bị chặn · z xong từ lần họp trước
- Job: quét n · đề xuất m proposal · chờ duyệt k

## Từng dự án
### <Dự án> — <n>% — <🟢/🟡/🔴>
- Hôm qua / tuần qua: ...
- Tiếp theo: ...
- Vướng: ...

## Quyết định cần chủ văn phòng
- [ ] ...

## Action items
| # | Việc | Người phụ trách | Hạn |
```

## Sau họp

1. Mỗi action item → tạo task (`POST /api/companies/{companyId}/issues`) với assignee, `parentId` = task họp.
2. Mục "Quyết định cần chủ văn phòng" → một `request_confirmation` trên task họp.
3. Đính kèm link biên bản trong comment kết thúc và gọi `office_status` với `state: "idle"`.

Biên bản ngắn gọn: standup ≤ 40 dòng, weekly ≤ 100 dòng.
