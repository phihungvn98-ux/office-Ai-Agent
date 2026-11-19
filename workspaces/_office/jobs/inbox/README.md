Thả file JSON job vào đây (n8n tự ghi từ email job alert, hoặc bạn tự dán). Mỗi file là 1 object hoặc 1 mảng:

```json
[{ "id": "upwork-0123", "platform": "upwork", "title": "...", "url": "https://...", "description": "...", "budget": "$500", "posted_at": "2026-11-19T08:00:00Z" }]
```

`jobs_fetch` đọc xong sẽ chuyển file sang `processed/`.
