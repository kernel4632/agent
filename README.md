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
| 服务端 | Bun + Elysia + [@kernel4632/agent-core](https://github.com/kernel4632/agent-core) |
| 分发 | `bun compile` 嵌入 Go 二进制 |

Agent 循环（模型请求、工具执行、上下文压缩）由独立发布的 `@kernel4632/agent-core` 提供，本项目不再自带实现。

## 运行模式

- 桌面模式：Wails 窗口
- CLI 模式：终端 TUI
- 开发模式：浏览器与独立服务端

三种模式共享同一个服务端。

## 数据目录

默认数据目录为 `%USERPROFILE%/.agent`，可通过 `AGENT_HOME` 修改：

```text
.agent/
  config.json
  sessions/
  tools/
```

- `config.json`：模型服务、系统提示词和工具权限规则（`permission` 字段）
- `sessions/<id>/`：每个会话一个目录，放 `meta.json` 和 `history.json`
- `tools/`：用户自己写的工具，启动时和内置工具一起扫描

配置中的 API Key、敏感请求头和 MCP 环境变量可使用 `${ENV_NAME}` 占位符。

## HTTP API

服务端公开以下资源：

| 方法 | 地址 | 说明 |
| --- | --- | --- |
| `GET` | `/config/read` | 读取配置 |
| `PATCH` | `/config/set` | 整体替换配置（含工具权限规则） |
| `POST` | `/session/create` | 创建会话 |
| `GET` | `/session/read/:sessionId` | 读取会话元信息和完整历史 |
| `PATCH` | `/session/rename/:sessionId` | 修改标题 |
| `DELETE` | `/session/remove/:sessionId` | 删除会话 |
| `POST` | `/session/rollback/:sessionId` | 回退到某条消息之前 |
| `POST` | `/session/redo/:sessionId` | 撤销上一次回退 |
| `POST` | `/session/compact/:sessionId` | 手动压缩上下文 |
| `POST` | `/agent/send/:sessionId` | 发送消息，任务在后台跑，过程走 SSE |
| `POST` | `/agent/stop/:sessionId` | 停止当前任务 |
| `POST` | `/agent/decide/:sessionId` | 处理 `deny`、`allow-once`、`allow-always` |
| `GET` | `/sse/connect/:sessionId` | 订阅带递增事件 ID 的 SSE |

错误响应统一是 `{ "error": "错误说明" }`：用户填错按 400、会话或消息不存在按 404、会话正在运行按 409、程序问题按 500。

工作区索引目前只存在于前端浏览器中，服务端没有对应接口。

## 验证

```text
cd server && bun run test
cd frontend && bun run build
cd frontend && bun run test:ui
```

`server/` 的测试会真实启动服务端并调用每一个接口，包括填错参数的情况，全部在临时数据目录里跑。
