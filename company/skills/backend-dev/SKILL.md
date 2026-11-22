---
name: backend-dev
description: Chuẩn làm việc backend — thiết kế API, cơ sở dữ liệu, xử lý lỗi, test, hiệu năng. Dùng khi task chạm API, server, database, tích hợp bên thứ ba.
---

# Backend

- Giữ nguyên công nghệ của dự án; không đổi framework/ngôn ngữ nếu không có quyết định ghi trong `DECISIONS.md`.
- **API:** hợp đồng rõ (đường dẫn, phương thức, mã lỗi, định dạng JSON). Kiểm tra và làm sạch mọi đầu vào ở biên. Lỗi trả mã đúng và thông báo không lộ chi tiết nội bộ.
- **Dữ liệu:** thay đổi schema bằng migration có thể hoàn tác; không xoá/sửa dữ liệu thật khi chưa có bản sao lưu và duyệt.
- **Tích hợp ngoài** (thanh toán, email...): bí mật qua biến môi trường, có timeout, retry có giới hạn, và chế độ sandbox khi test.
- **Test:** thêm test cho logic chính và đường lỗi; chạy toàn bộ bộ test trước khi báo xong.
- Câu truy vấn: tránh N+1, thêm chỉ mục khi cần, ghi chú nếu đánh đổi hiệu năng.
- Phối hợp FE: ghi hợp đồng API vào `notes/api.md` của dự án để FE bám theo.
- Chạm xác thực, phân quyền, thanh toán → nhờ `security` rà soát (báo qua `pm`).
