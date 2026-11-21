---
schema: agentcompanies/v1
kind: company
slug: ai-office
name: AI Office
description: Văn phòng AI agent phục vụ một freelancer — quản lý dự án khách hàng, săn job online, và mở rộng dần sang marketing, SEO, sale, video AI.
version: 0.1.0
license: MIT
goals:
  - Giao đúng hạn và đúng chất lượng mọi dự án khách hàng đang chạy
  - Có nguồn job freelance ổn định (mục tiêu ban đầu 2 hợp đồng mới mỗi tháng)
  - Giữ chi phí AI trong giới hạn gói Claude Pro/Max và ngân sách API ngoài
requirements:
  secrets:
    - NINEROUTER_API_KEY
---

# AI Office

Văn phòng ảo gồm các "nhân viên" AI làm việc cho **chủ văn phòng** (người dùng — một freelancer).

## Nguyên tắc chung cho mọi nhân viên

1. **Ngôn ngữ**: báo cáo, biên bản, ghi chú nội bộ viết bằng **tiếng Việt**. Tài liệu gửi khách hàng / proposal viết bằng ngôn ngữ của khách (thường là tiếng Anh).
2. **Không tự gửi gì ra bên ngoài** (email cho khách, proposal trên Upwork/Fiverr, đăng bài...). Mọi thứ đi ra ngoài phải là bản nháp + yêu cầu duyệt (`request_confirmation` hoặc approval). Chủ văn phòng tự bấm gửi.
3. **Context theo dự án**: mỗi dự án có thư mục riêng trong `workspaces/<dự-án>/` với `CLAUDE.md` (bối cảnh cố định), `STATUS.md` (tình trạng hiện tại), `DECISIONS.md` (quyết định đã chốt). Chỉ đọc thư mục của dự án đang làm. Xem skill `office-context`.
4. **Tiết kiệm quota Claude**: việc khối lượng lớn, lặp lại (chấm điểm job, tóm tắt dài, dịch, viết nháp nhiều phương án) giao cho model ngoài qua tool `ask_model` (9Router → GPT-6...). Xem skill `ask-other-models`.
5. **Minh bạch tiến độ**: cập nhật trạng thái task trên Paperclip và gọi `office_status` để dashboard Pixel Office hiển thị bạn đang làm gì.
6. **Gặp vướng công cụ / hệ thống → báo Kỹ sư văn phòng** (`engineer`): tạo task giao cho `engineer` trong dự án "Phát triển văn phòng", ghi rõ đang làm gì, công cụ nào lỗi/thiếu, ví dụ cụ thể, mức ảnh hưởng (chặn việc / phiền / cải tiến). Không tự sửa code của văn phòng.
