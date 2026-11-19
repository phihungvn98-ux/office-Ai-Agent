---
name: office-context
description: Quy ước tổ chức context theo từng dự án trong AI Office — thư mục workspaces, CLAUDE.md, STATUS.md, DECISIONS.md, cách đọc ít mà đủ và cách ghi tóm tắt cuối lượt. Dùng ở đầu và cuối mọi lượt làm việc.
---

# Office Context — tối ưu ngữ cảnh theo dự án

## Cấu trúc

```
workspaces/
  _office/              # việc nội bộ văn phòng: họp, săn job, hồ sơ năng lực
  <slug-du-an>/         # mỗi dự án khách hàng một thư mục
    CLAUDE.md           # bối cảnh cố định: khách hàng, mục tiêu, phạm vi, quy ước, link (ít thay đổi)
    STATUS.md           # tình trạng hiện tại — GHI ĐÈ mỗi lượt, tối đa ~60 dòng
    DECISIONS.md        # nhật ký quyết định — chỉ THÊM dòng
    notes/              # ghi chú chi tiết, biên bản làm việc với khách
    drafts/             # bản nháp gửi khách (chờ duyệt)
```

Thư mục làm việc (cwd) của bạn trong mỗi lượt chính là thư mục dự án đó, nên `CLAUDE.md` được nạp tự động.

## Đầu lượt — đọc tối thiểu

1. `STATUS.md` (luôn đọc).
2. `DECISIONS.md` — chỉ 20 dòng cuối, trừ khi cần tra cứu.
3. `notes/` — chỉ mở file liên quan trực tiếp tới task.
4. **Không** đọc thư mục của dự án khác. Cần thông tin chéo dự án → hỏi qua comment cho `manager`.
5. Việc nghiên cứu dài (đọc nhiều tài liệu, so sánh) → giao subagent hoặc `ask_model`, chỉ đưa kết luận vào context.

## Cuối lượt — ghi tóm tắt (ghi đè STATUS.md)

```markdown
# STATUS — <Tên dự án>
_Cập nhật: <YYYY-MM-DD HH:mm> bởi <agent>_

**Tiến độ:** <n>% · **Deadline gần nhất:** <ngày> — <mốc>
**Sức khỏe:** 🟢 đúng hạn | 🟡 có rủi ro | 🔴 trễ

## Đang làm
- ...
## Tiếp theo
- ...
## Rủi ro / chờ ai
- ...
## Gần đây đã xong
- ... (tối đa 5 dòng, cũ hơn thì xoá)
```

Quyết định mới → thêm 1 dòng vào `DECISIONS.md`: `- YYYY-MM-DD — <quyết định> — <lý do>`.

## Báo trạng thái lên Pixel Office

Gọi tool `office_status` (MCP `office`) khi bắt đầu việc lớn và khi xong:
- `state`: `working` | `meeting` | `researching` | `writing` | `waiting` | `idle`
- `message`: 1 câu ngắn tiếng Việt, ví dụ "Đang chấm 24 job Upwork mới"
- `progress`: 0–100 (nếu có)
- `project`: slug dự án
