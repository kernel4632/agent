# Agent

以会话为中心的个人 Agent 软件。用户在一个会话里持续对话，当前目录只是会话的一个属性；本仓库提供服务端、网页界面和 CLI 客户端。

## 现在有什么

| 部分 | 状态 | 说明 |
| --- | --- | --- |
| `server/` | 可用 | Bun + Elysia 服务端，42 个接口，`bun test` 覆盖每条路由 |
| `frontend/` | 可用 | Vue 3 界面，`bun run build` 能构建 |
| `design/` | 素材 | Figma 导出的设计 token 和组件数据 |
| 桌面端 | 还没写 | 计划用 Go + Wails，仓库里还没有代码 |
| `cli/` | 可用 | Go + Bubble Tea，支持交互聊天、单次提问、SSE、会话管理和工具审批；见 [CLI 使用说明](cli/README.md) |

## 功能

- 会话创建、重命名、分支、删除和按后续对话重新生成标题；列表存在服务端，换浏览器或清掉缓存都还在
- 当前目录 `cwd` 只是会话的一个属性：用户可以改，agent 也能用 `cwd` 工具自己移动，换目录不丢历史
- Markdown 消息、思考过程、工具调用和用量展示
- 消息回退与撤销回退，**回退时可同时把 agent 改过的文件恢复回去**；也可以只退某一次工具调用改的文件
- 查看 agent 改过哪些文件（改动前后对照）
- 任务清单和执行状态展示
- 工具权限规则：拒绝 / 允许一次 / 始终允许；敏感文件（`.env`、私钥、`.ssh`、agent 自己的数据目录）由文件工具自己判断，配置关不掉
- 停止运行中的任务，继续被中断的助手回复
- 内置十二个常驻工具，加上按需出现的技能读取工具、用户自己写的工具、MCP 外部服务和子智能体
- 自动识别本机其他软件留下的 MCP 配置和技能目录；识别只读，用户确认后再导入或启用
- MCP 服务和技能的日常管理：增删改、启停、连接测试、新建和编辑技能正文
- 供应商、模型、系统提示词、工具、MCP、技能、外观与数据设置；对话、压缩、标题、子任务可以分别指定模型

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | Vue 3 + JavaScript |
| 服务端 | Bun + Elysia + [@kernel4632/agent-core](https://github.com/kernel4632/agent-core) |

Agent 循环（模型请求、工具执行、上下文压缩）由独立发布的 `@kernel4632/agent-core` 提供，本项目不再自带实现；这个项目同时也是这个包的一个使用范例。

## 数据目录

默认数据目录在 macOS/Linux 为 `~/.agent`，Windows 为 `%USERPROFILE%\.agent`，可通过 `AGENT_HOME` 修改：

```text
.agent/
  config.json                模型服务、按任务的默认模型、工具权限规则、MCP 服务
  config-backups/            配置自动备份，保留最近 20 份
  session-groups.json        会话自定义分组、组顺序和组内顺序
  sessions/<id>/             每条会话一个目录
    meta.json                标题、当前目录、模型、时间
    history.json             消息和回退栈
    settings.json            思考强度
    tool-timings.json        工具开始/结束时间，刷新后恢复计时
    checkpoints.json         每次改文件的工具调用对应哪些快照
    snapshots/               改文件之前的原样副本
  tools/                     用户自己写的工具
  skills.json                启用了哪些外部技能目录、单独禁用了哪些技能
  cache/models-dev.json      models.dev 模型目录缓存，用于自动解析模型图标
```

技能不在数据目录里：全局技能在 `%USERPROFILE%\.agents\skills`，项目技能在会话当前目录的 `.agent/skills`，同名时项目版覆盖全局版。把 `AGENT_HOME` 指到临时目录做测试时，全局技能跟着放到 `<AGENT_HOME>/skills`，不会碰真实用户数据。设置页还会识别 Claude Code、Codex、Gemini CLI、opencode、Cursor 等软件留下的技能目录，用户启用后才参与技能清单；启用状态存在 `skills.json`。

内置工具在 `server/tools/`；按类别分文件，加一个工具只往这个目录放一个文件。内置技能目录不存在，技能全部来自上面两处用户数据。

## HTTP API

服务端公开 41 个地址、42 个接口（`/session/settings/{sessionId}` 有 GET 和 PATCH 两个方法）：

| 方法 | 地址 | 说明 |
| --- | --- | --- |
| `GET` | `/health` | 服务状态和版本 |
| `GET` | `/tool/list` | 工具名、类别、权限动作和界面信息 |
| `GET` | `/tool/kinds` | 工具类别 |
| `GET` | `/mcp/list` | 已配置的 MCP 服务和本机识别到的服务 |
| `POST` | `/mcp/save` | 新增或整体替换一个 MCP 服务 |
| `POST` | `/mcp/import` | 按识别编号导入本机的 MCP 服务 |
| `POST` | `/mcp/remove` | 删除一个 MCP 服务 |
| `PATCH` | `/mcp/toggle` | 启用或停用一个 MCP 服务 |
| `POST` | `/mcp/test` | 真实连接一次并列出工具名 |
| `GET` | `/skill/list` | 生效技能、候选目录和启用状态 |
| `GET` | `/skill/read` | 读取一个技能的正文 |
| `POST` | `/skill/save` | 新建或改写本应用自己的技能 |
| `POST` | `/skill/remove` | 删除本应用自己的技能 |
| `PATCH` | `/skill/toggle` | 把技能从模型清单里拿掉或放回来 |
| `PATCH` | `/skill/source` | 启用或停用一个外部技能目录 |
| `GET` | `/config/read` | 读取配置 |
| `GET` | `/config/meta` | 按任务的模型标签 |
| `PATCH` | `/config/set` | 整体替换配置 |
| `POST` | `/config/test` | 真实试一次模型请求 |
| `GET` | `/session/list` | 磁盘上的全部会话，带搜索 |
| `POST` | `/session/create` | 创建会话 |
| `POST` | `/session/fork/{sessionId}` | 从现有会话分出一个新分支 |
| `GET` | `/session/read/{sessionId}` | 会话、历史、任务清单、待批准 |
| `GET` | `/session/changes/{sessionId}` | agent 改过的文件，改动前后对照 |
| `GET` | `/session/settings/{sessionId}` | 会话运行设置 |
| `PATCH` | `/session/settings/{sessionId}` | 修改会话运行设置 |
| `GET` | `/session/tools/{sessionId}` | 每次改过文件的工具调用 |
| `PATCH` | `/session/rename/{sessionId}` | 改标题 |
| `POST` | `/session/title/{sessionId}` | 按后续对话重新生成标题 |
| `PATCH` | `/session/model/{sessionId}` | 换会话模型 |
| `PATCH` | `/session/cwd/{sessionId}` | 换会话当前目录 |
| `DELETE` | `/session/remove/{sessionId}` | 删除会话 |
| `POST` | `/session/rollback/preview/{sessionId}` | 回退前预览会消失多少消息、哪些文件 |
| `POST` | `/session/rollback/{sessionId}` | 回退对话和文件 |
| `POST` | `/session/rollback/tool/{sessionId}` | 只回退某一次工具调用改的文件 |
| `POST` | `/session/redo/{sessionId}` | 撤销上一次回退 |
| `POST` | `/session/compact/{sessionId}` | 压缩上下文 |
| `POST` | `/agent/send/{sessionId}` | 发送消息，过程走 SSE |
| `POST` | `/agent/resume/{sessionId}` | 继续被中断的助手 |
| `POST` | `/agent/stop/{sessionId}` | 停止任务 |
| `POST` | `/agent/decide/{sessionId}` | 处理工具审批 |
| `GET` | `/sse/connect/{sessionId}` | 订阅实时事件 |

错误响应统一是 `{ "error": "说明" }`：填错按 400、找不到按 404、会话在跑按 409、程序问题按 500。
完整说明见 [`server/openapi.json`](server/openapi.json)，前端怎么接见 [`server/README.md`](server/README.md)。

## macOS

支持本机后端、浏览器界面和 CLI，安装、启动及验证见 [macOS 使用说明](docs/MACOS.md)。

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
cd server && bun test          # 后端：真实启动服务端 + 真实 HTTP 请求，用临时数据目录
cd frontend && bun run test    # 前端逻辑测试
cd frontend && bun run build   # 前端能构建通过
cd cli && go test ./...        # CLI：HTTP/SSE 协议和终端交互
```

界面检查（Playwright）改到界面时手动跑：

```text
cd frontend && bun run test:ui
```

## 仓库约定

改代码前先看 [`AGENTS.md`](AGENTS.md)：
每完成一小步就提交推送、推送前改版本号、改接口要同时改三处契约文档。

## 许可证

Copyright (C) 2026 Kernyr

本项目以 [GNU Affero General Public License v3.0 或更新版本](LICENSE)（`AGPL-3.0-or-later`）开源。通过网络使用本项目时，请遵守 AGPL 第 13 条关于提供对应源代码的要求。
