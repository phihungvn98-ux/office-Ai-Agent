---
name: security-audit
description: Rà soát bảo mật mã nguồn và cấu hình dự án khách — OWASP Top 10, xác thực/phân quyền, lộ bí mật, thư viện lỗi thời. Dùng khi review code, trước khi giao khách, hoặc khi task chạm đăng nhập, thanh toán, dữ liệu cá nhân.
---

# Rà soát bảo mật

Phạm vi: **chỉ mã và hệ thống của dự án được giao**, theo hướng phòng thủ. Không quét/tấn công hệ thống bên thứ ba hay hệ thống khách chưa cho phép.

## Checklist
1. **Bí mật:** tìm key/token/mật khẩu trong code, lịch sử git, file cấu hình; có `.env.example`, `.gitignore` đúng.
2. **Xác thực & phân quyền:** băm mật khẩu đúng cách, phiên/JWT hết hạn, kiểm tra quyền ở **server** cho từng tài nguyên (chống IDOR).
3. **Đầu vào:** SQL/NoSQL injection, XSS, CSRF, path traversal, upload file, SSRF.
4. **Cấu hình:** CORS, header bảo mật, cookie (`HttpOnly`, `Secure`, `SameSite`), chế độ debug, thông báo lỗi lộ nội bộ.
5. **Thư viện:** chạy kiểm tra lỗ hổng (`npm audit` hoặc tương đương) và ghi lại.
6. **Dữ liệu cá nhân:** log có lộ thông tin nhạy cảm không; mã hoá khi cần.

## Báo cáo
Lưu `workspaces/<dự-án>/notes/security-<ngày>.md`: mỗi phát hiện gồm mức (Cao/Trung bình/Thấp), vị trí `file:dòng`, cách tái hiện, cách sửa đề xuất. Lỗi Cao → comment cho `pm` ngay.
Chỉ sửa code khi task yêu cầu rõ; mặc định chỉ báo cáo và đề xuất bản vá cho dev liên quan.
