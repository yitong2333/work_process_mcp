import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { listDailyReports, saveDailyReport, saveWeeklyReport } from "./platform.js";

const dateSchema = z.iso.date();

function result(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function createServer() {
  const server = new McpServer({ name: "work-progress", version: "0.1.0" });

  server.registerTool(
    "list_daily_reports",
    {
      title: "查询日报",
      description: "按日期范围查询当前登录账号的日报，可用于检查某天是否已填写。日期格式为 YYYY-MM-DD。",
      inputSchema: z.object({
        start_date: dateSchema,
        end_date: dateSchema,
      }),
    },
    async ({ start_date, end_date }) => {
      if (start_date > end_date) {
        throw new Error("start_date 不能晚于 end_date。");
      }
      return result(await listDailyReports(start_date, end_date));
    },
  );

  server.registerTool(
    "save_daily_report",
    {
      title: "保存日报草稿",
      description:
        "保存指定日期的日报草稿，不执行正式提交。completed 对应今日工作摘要，blockers 对应问题与风险，next_plan 对应明日计划；平台默认工时为 8 小时。日期格式为 YYYY-MM-DD。",
      inputSchema: z.object({
        date: dateSchema,
        completed: z.string().trim().min(1, "completed 不能为空"),
        blockers: z.string().default(""),
        next_plan: z.string().trim().min(1, "next_plan 不能为空"),
      }),
    },
    async ({ date, completed, blockers, next_plan }) =>
      result(await saveDailyReport(date, completed, blockers, next_plan)),
  );

  server.registerTool(
    "save_weekly_report",
    {
      title: "保存周报",
      description:
        "保存指定周的周报。week_start 必须是周一，格式为 YYYY-MM-DD；achievements 对应本周工作总结，next_plan 对应下周计划。平台可选的问题与风险字段留空。",
      inputSchema: z.object({
        week_start: dateSchema,
        achievements: z.string().trim().min(1, "achievements 不能为空"),
        next_plan: z.string().trim().min(1, "next_plan 不能为空"),
      }),
    },
    async ({ week_start, achievements, next_plan }) => {
      const dayOfWeek = new Date(`${week_start}T00:00:00.000Z`).getUTCDay();
      if (dayOfWeek !== 1) {
        throw new Error("week_start 必须是该周的周一。");
      }
      return result(await saveWeeklyReport(week_start, achievements, next_plan));
    },
  );

  return server;
}

serveStdio(createServer);
