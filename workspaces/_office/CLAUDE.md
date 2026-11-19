# AI Office — workspace nội bộ (_office)

Đây là thư mục làm việc cho việc **nội bộ văn phòng**: họp, săn job, tổng hợp. Không chứa dữ liệu chi tiết của dự án khách hàng (mỗi dự án có thư mục riêng `../<slug>/`).

## Bản đồ
- `profile.md` — hồ sơ năng lực của chủ văn phòng (dùng khi chấm job & viết proposal). **Chủ văn phòng tự điền.**
- `meetings/` — biên bản họp `YYYY-MM-DD-standup.md`, `YYYY-MM-DD-weekly.md`.
- `jobs/criteria.md` — tiêu chí nhận job.
- `jobs/sources.json` — nguồn job (copy từ `sources.example.json`).
- `jobs/inbox/` — job do n8n/email alert thả vào (JSON). `jobs/seen.json` — job đã xử lý.
- `jobs/proposals/` — proposal nháp chờ duyệt. `jobs/reports/` — báo cáo quét job hằng ngày.
- `STATUS.md` — tình trạng chung của văn phòng (Chánh văn phòng cập nhật sau mỗi buổi họp).

## Dự án khách hàng
Danh sách dự án: các thư mục `../*/` (trừ `_office`, `_template`). Khi họp, chỉ đọc `../<slug>/STATUS.md` của từng dự án.

## Quy tắc
- Báo cáo nội bộ: tiếng Việt, ngắn gọn, có số liệu.
- Không gửi bất cứ thứ gì ra ngoài. Proposal/email chỉ là nháp + yêu cầu duyệt.
- Tools MCP `office`: `ask_model`, `list_models`, `jobs_fetch`, `jobs_mark_seen`, `office_status`.
