---
name: job-scoring
description: Chấm điểm job freelance (0-100) theo hồ sơ năng lực và tiêu chí của chủ văn phòng, dùng model rẻ để lọc thô hàng loạt rồi đánh giá kỹ top job. Dùng khi quét job.
---

# Chấm điểm job

Đầu vào: danh sách job từ `jobs_fetch`, hồ sơ `workspaces/_office/profile.md`, tiêu chí `workspaces/_office/jobs/criteria.md`.

## Vòng 1 — lọc thô (rẻ, hàng loạt)

Gom 10–20 job/lần gửi `ask_model` (model mặc định của 9Router, ví dụ GPT-6) với prompt:

> Bạn là trợ lý lọc job freelance. Hồ sơ: <tóm tắt profile 10 dòng>. Tiêu chí: <criteria>. Với mỗi job, trả về JSON `[{"id": "...", "score": 0-100, "reason": "<15 từ"}]`. Chấm thấp job: ngoài kỹ năng, ngân sách quá thấp, mô tả mơ hồ, dấu hiệu lừa đảo (yêu cầu thanh toán ngoài nền tảng, liên hệ Telegram/WhatsApp ngay).

Bỏ job < 50.

## Vòng 2 — đánh giá kỹ (bạn tự làm, chỉ với job ≥ 50)

| Tiêu chí | Trọng số |
|---|---|
| Khớp kỹ năng / portfolio | 30 |
| Ngân sách & giá/giờ so với mức tối thiểu | 20 |
| Chất lượng khách (xác minh thanh toán, lịch sử chi tiêu, đánh giá) | 20 |
| Độ rõ ràng phạm vi & khả năng giao đúng hạn | 15 |
| Cạnh tranh (số proposal, thời gian đăng) | 15 |

Cảnh báo đỏ (trừ thẳng 40 điểm): yêu cầu làm thử miễn phí lớn, thanh toán ngoài nền tảng, xin thông tin cá nhân/tài khoản.

## Kết quả

Ghi vào báo cáo ngày, mỗi job: `điểm — tiêu đề — nền tảng — ngân sách — link — lý do 1 dòng`. Job ≥ 75 → viết proposal nháp.
