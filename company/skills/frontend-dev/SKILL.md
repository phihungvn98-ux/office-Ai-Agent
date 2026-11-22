---
name: frontend-dev
description: Chuẩn làm việc frontend — giao diện responsive, truy cập được (a11y), hiệu năng, trạng thái lỗi/tải, tích hợp API. Dùng khi task chạm giao diện web, component, CSS, trải nghiệm người dùng.
---

# Frontend

- Giữ nguyên framework và design system của dự án; tái dùng component sẵn có trước khi viết mới.
- **Responsive:** kiểm tra tối thiểu ở mobile (~375px), tablet, desktop.
- **Truy cập:** HTML ngữ nghĩa, nhãn cho input, tương phản đủ, thao tác được bằng bàn phím, `alt` cho ảnh.
- **Trạng thái:** luôn xử lý đang tải, rỗng, lỗi, thành công — không chỉ trường hợp lý tưởng.
- **Hiệu năng:** ảnh tối ưu, tải lười phần nặng, tránh thư viện lớn không cần thiết.
- **An toàn:** không chèn HTML thô từ dữ liệu người dùng (XSS), không lưu bí mật ở client.
- **Tích hợp API:** bám hợp đồng trong `notes/api.md`; thiếu/sai hợp đồng → comment cho `pm` để BE xử lý.
- Thay đổi giao diện → mô tả rõ thay đổi hiển thị (và ảnh chụp nếu có) trong comment báo cáo.
