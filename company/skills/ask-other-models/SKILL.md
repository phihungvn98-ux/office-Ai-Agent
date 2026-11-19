---
name: ask-other-models
description: Gọi model AI bên ngoài (GPT-6, Gemini API, model rẻ...) qua 9Router bằng tool ask_model để tiết kiệm quota Claude hoặc lấy góc nhìn thứ hai. Dùng cho việc hàng loạt, lặp lại, hoặc khi cần phản biện.
---

# Gọi model bên ngoài qua 9Router

Tool MCP `office` cung cấp:

- `ask_model({ prompt, system?, model?, temperature?, max_tokens?, json? })` → trả về text (hoặc JSON nếu `json: true`).
- `list_models()` → danh sách model 9Router đang có.

`model` bỏ trống = model mặc định trong cấu hình (`NINEROUTER_DEFAULT_MODEL`, ví dụ GPT-6).

## Khi nào dùng

| Việc | Dùng |
|---|---|
| Lọc/chấm thô hàng chục job, phân loại, trích xuất dữ liệu | `ask_model` (model rẻ) |
| Tóm tắt tài liệu dài, dịch | `ask_model` |
| Viết nhiều phương án nháp (tiêu đề, proposal thay thế) | `ask_model` |
| Phản biện kế hoạch / biên bản ("điều gì đang bị bỏ qua?") | `ask_model` (GPT-6) |
| Quyết định cuối, việc cần dùng tool, sửa file, việc nhạy cảm | Bạn (Claude) tự làm |

## Lưu ý

- Không gửi bí mật (mật khẩu, API key, dữ liệu cá nhân của khách) sang model ngoài.
- Kết quả từ model ngoài là **tham khảo** — bạn chịu trách nhiệm kiểm tra trước khi dùng.
- Nếu tool báo lỗi (9Router tắt, hết hạn mức), tiếp tục bằng Claude và ghi chú trong comment.
