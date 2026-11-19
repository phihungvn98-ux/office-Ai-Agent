---
name: Rà soát dự án khách hàng
slug: client-projects-review
assignee: pm
project: office-ops
recurring: true
---

Rà soát lần lượt từng dự án khách hàng (mỗi Project có workspace riêng trong `workspaces/<dự-án>/`):

1. Với mỗi dự án đang chạy, đọc `STATUS.md` + task đang mở của project đó.
2. Phát hiện: deadline trong 72h chưa xong, task không hoạt động > 3 ngày, khách đang chờ phản hồi.
3. Cập nhật lại `STATUS.md` (ghi đè theo mẫu trong skill `office-context`) và task trên Paperclip.
4. Việc cần làm tiếp của từng dự án → tạo task con trong project tương ứng (assign cho chính bạn), để lượt sau chạy trong đúng workspace của dự án đó.
5. Soạn nháp cập nhật tiến độ cho khách nếu đã > 5 ngày chưa cập nhật — gửi duyệt, không tự gửi.
