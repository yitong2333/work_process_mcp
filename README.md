# 工作进度平台 MCP

基于 Node.js 的 stdio MCP 服务，提供日报查询、日报草稿保存和周报保存三个工具。

## 工具

- `list_daily_reports(start_date, end_date)`：查询当前登录账号在日期范围内的日报。返回日期、状态、来源、工时和平台提供的摘要字段；空列表表示该范围内没有日报。
- `save_daily_report(date, completed, blockers, next_plan)`：保存日报草稿。`completed` 写入“今日工作摘要”，`blockers` 写入“问题与风险”，`next_plan` 写入“明日计划”。工时沿用平台默认值 8 小时。按平台页面区分，保存草稿不会执行“提交日报”。
- `save_weekly_report(week_start, achievements, next_plan)`：保存周报。`week_start` 必须是周一；`achievements` 写入“本周工作总结”，`next_plan` 写入“下周计划”，可选的问题与风险留空。平台按该周周五生成周报日期。

所有日期均使用 `YYYY-MM-DD`。日报的工作摘要和明日计划、周报总结和下周计划不能为空。

## 运行

需要 Node.js 20 或更新版本。

```powershell
npm install
npm start
```

MCP 客户端应通过 stdio 启动 `node`，参数指向本项目的 `src/index.js`。例如：

```json
{
  "mcpServers": {
    "work-progress": {
      "command": "node",
      "args": ["C:\\Temp\\算法工作进度mcp\\src\\index.js"],
      "env": {
        "WORK_REPORT_BASE_URL": "http://112.53.80.34:8100",
        "WORK_REPORT_USERNAME": "本机配置的平台账号",
        "WORK_REPORT_PASSWORD": "本机配置的平台密码"
      }
    }
  }
}
```

服务首次收到工具调用时会使用环境变量中的账号密码登录平台，并把登录 Cookie 仅保存在 MCP 进程内存中。接口检测到登录失效后，会自动重新登录并重试一次。服务不会读取浏览器 Cookie、把会话写入磁盘或记录账号密码和 Cookie。

请只在本机 MCP 客户端配置或进程环境中设置账号密码，不要提交到仓库或发送到聊天中。当前平台地址使用 HTTP，登录密码和会话 Cookie 会在网络中明文传输；请仅在平台所在的可信网络内使用。

`.env.example` 列出可用变量供复制参考；服务从 MCP 客户端传入的进程环境中读取配置，不会自动读取 `.env` 文件。

## 配置项

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `WORK_REPORT_BASE_URL` | `http://112.53.80.34:8100` | 平台根地址 |
| `WORK_REPORT_USERNAME` | 无 | 平台账号 |
| `WORK_REPORT_PASSWORD` | 无 | 平台密码 |
| `WORK_REPORT_REQUEST_TIMEOUT_MS` | `15000` | 单次接口请求超时 |
| `WORK_REPORT_DAILY_LIST_PATH` | `/report/my/list` | 日报列表接口路径 |
| `WORK_REPORT_DAILY_SAVE_PATH` | `/report/my/save` | 日报草稿保存接口路径（请求带 `submit=0`，不上交） |
| `WORK_REPORT_WEEKLY_SAVE_PATH` | `/report/weekly/save` | 周报保存接口路径 |
| `WORK_REPORT_DAILY_START_PARAM` | `beginDate` | 日报开始日期查询参数名 |
| `WORK_REPORT_DAILY_END_PARAM` | `endDate` | 日报结束日期查询参数名 |

页面表单字段已按平台显示名称和字段标识映射。若后端接口路径或日期筛选参数在当前部署版本中不同，可通过上述环境变量覆盖。服务不会读取浏览器 Cookie、把会话写入磁盘或记录账号密码和 Cookie。

默认接口已按当前部署（RuoYi 4.x 风格）实测对齐：日报列表为 POST `/report/my/list`（表单参数），日报草稿为 POST `/report/my/save?submit=0`（JSON 请求体），周报为 POST `/report/weekly/save`（表单）。`list_daily_reports` 已实测可返回数据；首次保存后请在平台确认记录显示为草稿。若其他部署的请求方式或路由不同，请按上表覆盖接口路径或日期参数名。
