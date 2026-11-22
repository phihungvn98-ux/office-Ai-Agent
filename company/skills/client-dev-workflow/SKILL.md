---
name: client-dev-workflow
description: Quy trình chung cho dev (BE, FE, bảo mật) khi code cho dự án khách hàng — nhánh riêng, test, commit, báo cáo, xin duyệt trước khi giao khách. Dùng mỗi khi nhận task code của dự án khách.
---

# Quy trình code cho dự án khách

1. Đọc `CLAUDE.md` và `STATUS.md` của đúng dự án (xem skill `office-context`). Không đọc dự án khác.
2. Làm việc trong thư mục dự án `workspaces/<dự-án>/`. Dự án có git → tạo nhánh `feat/<task>` hoặc `fix/<task>`, **không commit thẳng vào `main`** của khách.
3. Viết code nhỏ, rõ; thêm/chạy test của dự án. Không có test → tự kiểm tra bằng cách chạy thật và ghi lại bước kiểm tra.
4. Commit thông điệp ngắn, rõ ràng. **Không push, không deploy, không gửi gì ra ngoài** — chỉ chủ văn phòng duyệt rồi mới làm (`request_confirmation`, `resolverPolicy: human_only`).
5. Cuối lượt, comment trên task: đã làm gì, file nào đổi, kết quả test, rủi ro, bước tiếp. Cập nhật `STATUS.md` (ghi đè) và thêm quyết định kỹ thuật vào `DECISIONS.md`.
6. Không đưa API key, token, mật khẩu vào code, commit hay comment. Dùng biến môi trường và `.env.example`.
7. Hệ thống văn phòng/công cụ lỗi → tạo task cho `engineer`. Cần dev khác (BE↔FE↔bảo mật) → comment cho `pm`, không tự giao.
