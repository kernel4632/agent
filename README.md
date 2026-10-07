# Agent

围绕工作区和会话组织对话的个人 Agent 软件。本仓库目前有服务端和前端两部分。

## 现在有什么

| 部分 | 状态 | 说明 |
| --- | --- | --- |
| `server/` | 可用 | Bun + Elysia 服务端，19 个接口，`bun run test` 全覆盖 |
| `frontend/` | 可用 | Vue 3 界面，`bun run build` 能构建 |
| `design/` | 素材 | Figma 导出的设计 token 和组件数据 |
| 桌面端 | 还没写 | 计划用 Go + Wails，仓库里还没有代码 |
| CLI | 还没写 | 计划用 Go + BubbleTea，仓库里还没有代码 |

## 功能

- 会话创建、重命名、删除；列表存在服务端，换浏览器或清掉缓存都还在
- 按工作区归类，主页显示工作区路径、文件列表和 git 状态
- Markdown 消息、思考过程、工具调用和用量展示
- 消息回退与撤销回退，**回退时同时把 agent 改过的文件恢复回去**
- 查看 agent 改过哪些文件（改动前后对照）
- 任务清单和执行状态展示
- 工具权限规则，拒绝 / 允许一次 / 始终允许；敏感文件由 `.agentignore` 兜底
- 停止运行中的任务
- 内置十二个工具，加上用户自己写的工具、MCP 外部服务和技能
- 供应商、模型、系统提示词、工具、MCP、外观与数据设置

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | Vue 3 + JavaScript |
| 服务端 | Bun + Elysia + [@kernel4632/agent-core](https://github.com/kernel4632/agent-core) |

Agent 循环（模型请求、工具执行、上下文压缩）由独立发布的 `@kernel4632/agent-core` 提供，本项目不再自带实现；这个项目同时也是这个包的一个使用范例。

## 数据目录

默认数据目录为 `%USERPROFILE%\.agent`，可通过 `AGENT_HOME` 修改：

```text
.agent/
  config.json        模型服务、系统提示词、工具权限规则、MCP 服务
  .agentignore       额外的不许工具碰的文件（可选）
  sessions/<id>/     每条会话一个目录：meta.json、history.json、文件快照
  tools/             用户自己写的工具
  skills/            用户自己的技能，一个文件夹一份 SKILL.md
```

内置工具在 `server/tools/`，内置技能在 `server/skills/`；同名时用户版本覆盖内置版本。

## HTTP API

服务端公开这些资源：

| 方法 | 地址 | 说明 |
| --- | --- | --- |
| `GET` | `/health` | 服务状态和版本 |
| `GET` | `/workspace/read` | 工作区路径、文件列表、git 状态 |
| `GET` | `/workspace/status` | 某个目录的 git 状态 |
| `GET` | `/config/read` | 读取配置 |
| `PATCH` | `/config/set` | 整体替换配置 |
| `POST` | `/config/test` | 真实试一次模型请求 |
| `GET` | `/session/list` | 磁盘上的全部会话，带搜索 |
| `POST` | `/session/create` | 创建会话 |
| `GET` | `/session/read/:id` | 会话、历史、任务清单、待批准 |
| `GET` | `/session/changes/:id` | agent 改过的文件，改动前后对照 |
| `PATCH` | `/session/rename/:id` | 改标题 |
| `DELETE` | `/session/remove/:id` | 删除会话 |
| `POST` | `/session/rollback/:id` | 回退对话和文件 |
| `POST` | `/session/redo/:id` | 撤销上一次回退 |
| `POST` | `/session/compact/:id` | 压缩上下文 |
| `POST` | `/agent/send/:id` | 发送消息，过程走 SSE |
| `POST` | `/agent/stop/:id` | 停止任务 |
| `POST` | `/agent/decide/:id` | 处理工具审批 |
| `GET` | `/sse/connect/:id` | 订阅实时事件 |

错误响应统一是 `{ "error": "说明" }`：填错按 400、找不到按 404、会话在跑按 409、程序问题按 500。
完整说明见 [`server/openapi.json`](server/openapi.json)，前端怎么接见 [`server/README.md`](server/README.md)。

## 跑起来

```powershell
cd server
bun install
bun start
```

服务默认在 `http://localhost:3000`，然后：

```powershell
cd frontend
bun install
bun run dev
```

界面在 `http://127.0.0.1:5173`，会把 `/api` 转发到后端。
数据目录和模型配置怎么填见 [`server/README.md`](server/README.md)。

## 验证

```text
cd server && bun test         # 真实启动服务端 + 真实 HTTP 请求，用临时数据目录
cd frontend && bun run build  # 前端能构建通过
```

界面检查（Playwright）改到界面时手动跑：

```text
cd frontend && bun run test:ui
```

## 仓库约定

改代码前先看 [`AGENTS.md`](AGENTS.md)：
每完成一小步就提交推送、推送前改版本号、改接口要同时改三处契约文档。
