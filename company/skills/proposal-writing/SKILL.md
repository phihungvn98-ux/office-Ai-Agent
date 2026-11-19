---
name: proposal-writing
description: Viết proposal/cover letter nháp cho job freelance, cá nhân hoá theo đúng job, ngắn gọn, có bằng chứng năng lực. Bản nháp luôn chờ chủ văn phòng duyệt — không bao giờ tự gửi.
---

# Viết proposal nháp

## Nguyên tắc

- Ngôn ngữ của khách (thường tiếng Anh). 120–220 từ. Không văn mẫu sáo rỗng.
- Câu đầu tiên nói thẳng vào vấn đề của khách (chứng minh đã đọc kỹ job).
- 1–2 bằng chứng cụ thể từ `profile.md` (dự án tương tự, kết quả đo được, link portfolio).
- Đề xuất cách làm 3–4 bước ngắn + mốc thời gian.
- Kết bằng 1 câu hỏi làm rõ để mở hội thoại.
- Không hứa điều không có trong hồ sơ. Không bịa số liệu/khách hàng.

## Quy trình

1. Viết bản nháp chính.
2. (Tuỳ chọn, tiết kiệm quota) Gọi `ask_model` để có bản thay thế với giọng văn khác, chọn bản tốt hơn hoặc trộn.
3. Lưu file `workspaces/_office/jobs/proposals/<YYYY-MM-DD>-<slug>.md`:

```markdown
---
job_id: <id>
platform: <upwork|fiverr|freelancer|...>
url: <link job>
score: <điểm>
budget: <ngân sách>
status: draft   # draft → approved → sent (chủ văn phòng cập nhật)
---
# <Tiêu đề job>

## Proposal
<nội dung>

## Giá đề xuất & thời gian
<giá> · <thời gian>

## Ghi chú cho chủ văn phòng (không gửi khách)
<vì sao nên nhận, rủi ro, câu hỏi cần làm rõ>
```
