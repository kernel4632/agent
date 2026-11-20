# Agent

agent-core 的可视化界面和扩展系统，带一组可开关的内置扩展示例。面向二次开发，不是最终产品。

Agent 循环和历史写入只来自 `@kernel4632/agent-core`（本仓库用本地 `file:../../agent-core`，当前是尚未发布到 npm 的 1.2.1）。没有的能力才用扩展加入。

## 现在有什么

| 部分 | 版本 | 说明 |
| --- | --- | --- |
| `backend/` | 0.2.1 | Bun.serve，把 agent-core 事件原样推给前端，并加载扩展 |
| `web/` | 0.6.1 | Vue 3 对话页，经 `/api` 连到后端 |
| `extensions/` | 内置 8 个 | 会话、设置、基础工具、权限审批、技能、任务清单、MCP 管理、自动标题 |

旧的 `server/`、`frontend/`、`cli/` 已经删除。桌面端还没写。

## 跑起来

先在 `~/.agent/config.json` 写好供应商和模型（没有配置时界面仍能打开，但不能发送）：

```json
{
  "providers": [
    {
      "name": "relay",
      "baseURL": "https://example.com/v1",
      "apiKey": "sk-...",
      "protocol": "chat",
      "models": [{ "id": "glm-latest", "name": "GLM", "context": 128000 }]
    }
  ],
  "models": { "chat": "relay/glm-latest", "compact": "" }
}
```

然后开两个终端：

```sh
cd backend && bun install && bun start    # 127.0.0.1:3000
cd web && bun install && bun dev          # 127.0.0.1:5180，把 /api 代理到后端
```

打开 http://127.0.0.1:5180 。左侧是会话列表，加号菜单里有设置、任务清单、技能、MCP。演示模式（不连后端、也没有扩展界面）：http://127.0.0.1:5180/?demo

数据目录是 `AGENT_HOME`，默认 `~/.agent`：

```text
~/.agent/
  config.json                 供应商、模型、权限规则、MCP、扩展关闭名单
  agents/<id>/meta.json       标题、分组、模型、思考强度
  agents/<id>/history.jsonl   一行一条 core 消息
```

## HTTP 与推送

| 方法 | 地址 | 说明 |
| --- | --- | --- |
| `GET` | `/api/agent/:id/stream` | SSE：先发 `snapshot`，再推 `core` / `run` / `cut` / 扩展事件 |
| `POST` | `/api/agent/:id/send` | 发送或继续（可带 `cut` 改写重发），202；正在跑则 409 |
| `POST` | `/api/agent/:id/compact` | 手动压缩 |
| `POST` | `/api/agent/:id/stop` | 停止 |
| `POST` | `/api/agent/:id/configure` | 换模型或思考强度 |
| `GET` | `/api/extensions` | 已加载扩展的前端入口 |
| `GET` | `/api/extensions/:name/frontend.js` | 打包好的扩展前端 |
| `POST` | `/api/op/:name` | 扩展动作（会话列表、设置读写、权限回答等） |

`core` 事件就是 agent-core 的事件（含每条历史的 `message`）。`run` 表示整轮开始或结束，`cut` 表示宿主截断了历史。进程重启后不自动续跑。

## 内置扩展

写法和第三方相同，默认开启，可在设置里关闭或替换。不做 git、工作区边界、项目规则和斜杠命令。

- **会话**：多会话、搜索、分组，侧栏切换就是换 id 再连 stream（地址是 `#/s/<id>`）
- **设置**：汇总各扩展的配置描述，用原生控件按类型渲染
- **基础工具**：读改写文件、列目录、命令、抓网页，以及返回 `{ stop: true }` 的 `finish`
- **权限审批**：按规则允许 / 拒绝 / 询问；不装这个扩展时，core 不传回调，工具直接执行
- **技能**、**任务清单**、**MCP 管理**、**自动标题**（截取第一条用户消息，不另调模型）

扩展目录在项目的 `extensions/` 和 `~/.agents/extensions`。

## 验证

```sh
cd backend && bun test         # mock，默认不打真实模型
cd web && bun run check        # 类型检查
cd web && bun run build
```

一次真实模型请求（需本机密钥，会消耗额度）：

```sh
cd backend && RUN_REAL=1 bun test tests/real.send.test.js
```

## 约定

改代码前看 [`AGENTS.md`](AGENTS.md) 和 [`NOTES.md`](NOTES.md)。macOS 安装步骤见 [docs/MACOS.md](docs/MACOS.md)。

## 许可证

Copyright (C) 2026 Kernyr

本项目以 [GNU Affero General Public License v3.0 或更新版本](LICENSE)（`AGPL-3.0-or-later`）开源。通过网络使用本项目时，请遵守 AGPL 第 13 条关于提供对应源代码的要求。
