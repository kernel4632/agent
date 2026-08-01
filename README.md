# Agent

围绕工作区和会话组织对话的桌面与 CLI 软件。

## 功能

- 工作区管理与按工作区归类的会话列表
- 会话创建、重命名、删除和模型切换
- Markdown 消息、思考过程、工具调用、usage 与上下文占比展示
- 文件上传、消息撤回、工具步骤回退与撤销回退
- 会话任务列表和执行状态展示
- 工具权限规则，以及拒绝、单次允许和始终允许审批
- 运行中的会话停止
- 文件、Shell 和 Web 操作的展示与权限审批
- MCP 服务配置
- 供应商、模型、系统提示词、工具、MCP、外观与数据设置

## 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面 | Go + Wails |
| CLI | Go + BubbleTea |
| 前端 | Vue 3 + JavaScript |
| 服务端 | Bun + Elysia + Vercel AI SDK |
| 分发 | `bun compile` 嵌入 Go 二进制 |

## 运行模式

- 桌面模式：Wails 窗口
- CLI 模式：终端 TUI
- 开发模式：浏览器与独立服务端

三种模式共享同一个服务端。

## 数据目录

默认数据目录为 `%USERPROFILE%/.agent`，可通过 `AGENT_DATA_DIR` 修改：

```text
.agent/
  config.json
  workspace.json
  mcp.json
  sessions/
  skills/
  tools/
```

配置中的 API Key、敏感请求头和 MCP 环境变量可使用 `${ENV_NAME}` 占位符。服务从环境读取真实值，配置接口返回脱敏内容。

## HTTP API

服务端只公开四个顶级资源：

- `/health`：`GET` 获取服务状态和版本
- `/config`：`GET` 获取脱敏配置，`PATCH` 修改配置
- `/workspace`：`GET`、`POST`、`PATCH`、`DELETE` 管理工作区
- `/session`：`GET`、`POST`、`PATCH`、`DELETE` 管理会话

会话操作使用以下子路径：

- `POST /session/send` 发送消息并启动后台执行
- `POST /session/stop` 停止当前执行和等待中的工具
- `GET /session/events` 订阅带递增事件 ID 的 SSE
- `POST /session/approval` 处理 `deny`、`allow-once`、`always-allow`
- `POST /session/history` 执行工具步骤回退、消息回退或撤销回退

## 验证

```text
cd server && bun run test
cd frontend && bun run build
cd frontend && bun run test:ui
```
