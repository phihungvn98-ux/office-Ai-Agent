#!/usr/bin/env node
// AI Office — MCP server "office"
// Tools cho nhân viên AI: gọi model ngoài qua 9Router, lấy job freelance, báo trạng thái lên Pixel Office.
// Chạy qua stdio (Claude Code tự khởi động theo .mcp.json của từng workspace).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { askModel, listModels } from "./lib/llm.mjs";
import { fetchJobs, markSeen } from "./lib/jobs.mjs";
import { reportStatus } from "./lib/status.mjs";
import { config } from "./lib/config.mjs";

const server = new McpServer({ name: "office", version: "0.1.0" });

const text = (value) => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
});
const fail = (err) => ({ isError: true, content: [{ type: "text", text: `Lỗi: ${err?.message ?? err}` }] });

server.registerTool(
  "ask_model",
  {
    title: "Hỏi model ngoài (9Router)",
    description:
      "Gửi prompt tới model AI bên ngoài qua 9Router (OpenAI-compatible), ví dụ GPT-6 hoặc Gemini API. " +
      "Dùng cho việc hàng loạt/lặp lại (lọc, chấm điểm, tóm tắt, dịch, viết nhiều phương án) để tiết kiệm quota Claude, " +
      "hoặc để lấy góc nhìn phản biện. Không gửi bí mật/dữ liệu nhạy cảm.",
    inputSchema: {
      prompt: z.string().min(1).describe("Nội dung yêu cầu"),
      system: z.string().optional().describe("System prompt (tuỳ chọn)"),
      model: z.string().optional().describe(`Tên model trong 9Router. Mặc định: ${config.defaultModel}`),
      temperature: z.number().min(0).max(2).optional(),
      max_tokens: z.number().int().positive().max(32000).optional(),
      json: z.boolean().optional().describe("true = yêu cầu model trả JSON và parse sẵn"),
    },
  },
  async (args) => {
    try {
      return text(await askModel(args));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "list_models",
  {
    title: "Danh sách model 9Router",
    description: "Liệt kê các model đang khả dụng trong 9Router.",
    inputSchema: {},
  },
  async () => {
    try {
      return text(await listModels());
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "jobs_fetch",
  {
    title: "Lấy job freelance mới",
    description:
      "Lấy job mới từ các nguồn hợp lệ cấu hình trong workspaces/_office/jobs/sources.json " +
      "(Freelancer.com API công khai, RSS được phép, inbox do n8n/email alert đưa vào). " +
      "Tự loại job đã xem. Trả về danh sách job đã chuẩn hoá. Không đăng nhập hay scrape nền tảng.",
    inputSchema: {
      limit: z.number().int().positive().max(200).optional().describe("Số job tối đa trả về (mặc định 40)"),
      query: z.string().optional().describe("Ghi đè từ khoá tìm kiếm cho nguồn hỗ trợ query"),
      include_seen: z.boolean().optional().describe("true = trả cả job đã xem"),
    },
  },
  async (args) => {
    try {
      return text(await fetchJobs(args));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "jobs_mark_seen",
  {
    title: "Đánh dấu job đã xử lý",
    description: "Đánh dấu các job id đã xem/xử lý để lần quét sau không trả lại.",
    inputSchema: { ids: z.array(z.string()).min(1) },
  },
  async ({ ids }) => {
    try {
      return text(await markSeen(ids));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "office_status",
  {
    title: "Báo trạng thái lên Pixel Office",
    description:
      "Cập nhật trạng thái của bạn trên dashboard Pixel Office (đang làm gì, tiến độ). " +
      "Gọi khi bắt đầu việc lớn, khi vào/ra họp và khi xong việc.",
    inputSchema: {
      state: z.enum(["working", "meeting", "researching", "writing", "waiting", "idle"]),
      message: z.string().max(200).describe("1 câu ngắn tiếng Việt"),
      progress: z.number().min(0).max(100).optional(),
      project: z.string().optional().describe("slug dự án"),
    },
  },
  async (args) => {
    try {
      return text(await reportStatus(args));
    } catch (err) {
      return fail(err);
    }
  },
);

await server.connect(new StdioServerTransport());
