# 接口参考

本文是 `server/openapi.json` 的可读版本，**接口清单会随代码变化，以 `openapi.json` 为准**。
`openapi.json` 由 `server/api.js` + `server.js` 的路由自动生成，不会和代码脱钩：

```bash
cd server
bun run openapi          # 改了接口后重新生成
bun run openapi:check    # 只检查是否过期
```

所有 JSON 请求使用 `Content-Type: application/json`。错误响应统一是 `{ "error": "错误说明" }`。

| 状态码 | 含义 |
| --- | --- |
| `400` | 请求参数不正确，比如标题为空、目录不存在、供应商不存在、审批决定不认识 |
| `404` | 会话、消息、技能或工具调用不存在 |
| `409` | 会话已有任务在运行，或继续位置不对 |
| `500` | 后端执行失败 |

## 服务状态

| 方法 | 地址 | 结果 |
| --- | --- | --- |
| `GET` | `/health` | `{ "ok": true, "version": "运行版本", "targetVersion": "代码版本", "restartRequired": false, "sessions": 2, "running": 1 }` |

## 配置

| 方法 | 地址 | 结果 |
| --- | --- | --- |
| `GET` | `/config/read` | 当前完整配置 |
| `GET` | `/config/meta` | 按任务的模型标签：`models` |
| `PATCH` | `/config/set` | 保存后的完整配置 |
| `POST` | `/config/test` | `{ provider?, model? }`，真实请求一次模型 |
| `GET` | `/config/backups` | 自动配置备份列表，按时间倒序 |
| `GET` | `/config/backups/{id}` | 备份元数据和脱敏配置；不返回 API Key |
| `POST` | `/config/restore` | `{ id }`，恢复前自动备份当前配置 |
| `GET` | `/config/export?secrets=0\|1` | 下载配置；默认脱敏，`1` 才包含明文密钥 |
| `POST` | `/config/import` | `{ config }`，整体导入；脱敏字段保留同名供应商现有密钥 |

## 文件系统与会话存储位置

| 方法 | 地址 | 参数 | 结果 |
| --- | --- | --- | --- |
| `GET` | `/filesystem/entries` | `path`、`mode=directory\|file` | 只读列一层目录/文件，供路径选择器使用；不读取文件内容 |
| `GET` | `/storage/sessions` | 无 | `{ path, defaultPath, envOverride, pending, error, lastMove }` |
| `PUT` | `/storage/sessions` | `{ "path": "D:\\AgentSessions" }` | 只写入待迁移标记；重启后复制并切换，目标必须是空目录 |
| `DELETE` | `/storage/sessions` | 无 | 取消尚未执行的迁移 |

迁移只处理 `sessions/`，配置、工具和技能不动。`AGENT_SESSIONS` 存在时，`PUT` 会按 409 返回，界面上也不能修改。

## 工具

| 方法 | 地址 | 结果 |
| --- | --- | --- |
| `GET` | `/tool/list` | 工具名、类别、权限动作、`configurable`、工具自带的 `ui` |
| `GET` | `/tool/kinds` | 工具类别：`kind`、`label`、`hint` |

## 模型图标

| 方法 | 地址 | 参数 | 结果 |
| --- | --- | --- | --- |
| `GET` | `/model/family` | `model`、`family?` | `{ family, candidates, ambiguous, source }` |
| `GET` | `/model/icon` | `model`、`family?`、`theme?` | SVG 图片；找不到时 404 |

## 能力管理

| 方法 | 地址 | 结果 |
| --- | --- | --- |
| `GET` | `/mcp/list` | 已配置服务 + 本机其他软件留下的配置（`env` / `headers` 只有键名） |
| `POST` | `/mcp/save` | `{ name, definition }` |
| `POST` | `/mcp/import` | `{ ids }`，按编号重新读源文件，环境变量完整写入 |
| `POST` | `/mcp/remove` | `{ name }` |
| `PATCH` | `/mcp/toggle` | `{ name, enabled }` |
| `POST` | `/mcp/test` | 真实连一次，返回 `{ ok, tools }` 或 `{ ok: false, error }` |
| `GET` | `/skill/list` | 生效清单 + 本机识别到的目录；禁用中的技能带 `enabled: false` |
| `GET` | `/skill/read` | `name`，返回技能正文 |
| `POST` | `/skill/save` | `{ name, description, body, scope }` |
| `POST` | `/skill/remove` | `{ name, scope }` |
| `PATCH` | `/skill/toggle` | `{ name, enabled }`，只影响清单，文件不动 |
| `PATCH` | `/skill/source` | `{ path, enabled }`，启用或停用外部技能目录 |

## 会话

| 方法 | 地址 | 说明 |
| --- | --- | --- |
| `GET` | `/session/list` | 会话摘要列表，最近用过的在前；`search` 匹配标题和模型名 |
| `GET` | `/session/groups` | 会话分组 `{ groups }` |
| `PUT` | `/session/groups` | 整体替换分组；一个会话只能属于一个分组 |
| `POST` | `/session/create` | `{ title, cwd?, provider?, model? }` |
| `POST` | `/session/fork/{sessionId}` | 从现有会话分出新分支，可只复制到某条消息 |
| `GET` | `/session/read/{sessionId}` | 完整会话；`historyStart` / `historyLimit` 控制读取哪一页 |
| `GET` | `/session/history/{sessionId}` | 历史分页；`before` 是消息下标 |
| `GET` | `/session/outline/{sessionId}` | 整个会话的轮次大纲，只带预览 |
| `GET` | `/session/changes/{sessionId}` | 这个任务改了哪些文件 |
| `GET` | `/session/tools/{sessionId}` | 每次改过文件的工具调用 |
| `PATCH` | `/session/rename/{sessionId}` | `{ title }` |
| `PATCH` | `/session/cwd/{sessionId}` | `{ cwd }`，只改目录，历史、模型、设置都不动 |
| `PATCH` | `/session/model/{sessionId}` | `{ provider, model }`；运行中也能切，下一轮生效 |
| `GET` | `/session/settings/{sessionId}` | 会话运行设置 |
| `PATCH` | `/session/settings/{sessionId}` | 只改点名的字段 |
| `POST` | `/session/title/{sessionId}` | 让模型重新起一个标题 |
| `POST` | `/session/compact/{sessionId}` | 手动压缩上下文 |
| `DELETE` | `/session/remove/{sessionId}` | 删除会话和历史 |
| `POST` | `/session/rollback/preview/{sessionId}` | `{ messageId }`，预览会一起回退哪些工具调用 |
| `POST` | `/session/rollback/tool/{sessionId}` | `{ toolCallId, files? }`，只回退这一次工具改的文件 |
| `POST` | `/session/rollback/{sessionId}` | `{ messageId, files? }`，回退到这条消息之前 |
| `POST` | `/session/redo/{sessionId}` | `{ files? }`，撤销最近一次回退 |

## Agent

| 方法 | 地址 | 说明 |
| --- | --- | --- |
| `POST` | `/agent/send/{sessionId}` | `{ input }`；`input` 是字符串或内容块数组 |
| `POST` | `/agent/resume/{sessionId}` | 从历史末尾续跑，不新增用户消息 |
| `POST` | `/agent/stop/{sessionId}` | `{ partial? }`，带上已经流出的半段回复，刷新后不丢 |
| `POST` | `/agent/decide/{sessionId}` | `{ toolCallId, decision }`，`decision` 是 `allow-once` / `allow-always` / `deny` |

## SSE 事件

```text
GET /sse/connect/:sessionId
Accept: text/event-stream
```

每条事件的 `data` 是 JSON：

| `type` | 主要字段 | 前端行为 |
| --- | --- | --- |
| `text-delta` | `text`，压缩时 `request: 'compact'` | 仅普通回答追加到 assistant 文本 |
| `reasoning-delta` | `text`，压缩时 `request: 'compact'` | 仅普通回答追加到 assistant 思考文本 |
| `retry` | `attempt`, `error`, `delay` | 显示正在重试 |
| `llm-start` | `messages`, `tools`, `startedAt`, `provider`, `model` | 显示正在请求模型；`startedAt` 是这次请求的真实开始时间，重连后计时接着走 |
| `llm-first-token` | `firstTokenAt`, `firstTokenMs` | 第一次收到内容增量；用来显示首字时间，重连后也能恢复 |
| `llm-finish` | `text`, `toolCalls`, `finishReason`, `usage`, `durationMs` | 统计本轮模型请求；`usage` 里带 `firstTokenMs`、`durationMs`、输入 / 输出 / 缓存和这次请求的 `provider` / `model` |
| `tool-call` | `toolCallId`, `toolName`, `input` | 创建工具卡片 |
| `tool-output` | `toolName`, `stream`, `data` | 追加工具实时输出 |
| `tool-result` | `toolCallId`, `toolName`, `input`, `output` | 更新工具最终结果；拒绝、取消、无效调用也会结算 |
| `permission` | `callID`, `tool`, `input` | 显示“始终允许 / 允许一次 / 拒绝” |
| `permission-blocked` | `callID`, `tool`, `input`, `reason` | 被权限规则拒绝，不用等用户决定 |
| `mcp-error` | `server`, `error` | 某个 MCP 服务没连上，只是跳过 |
| `compact-start` / `compact-finish` | `messages` + `startedAt` / `content`, `usage`, `durationMs` | 上下文压缩进度；`usage` 已统一成 `input` / `output` / `cacheRead` / `total` |
| `title` | `title` | 后端起好了标题 |
| `agent-start` | 无 | 任务开始 |
| `agent-resume` | 无 | 继续任务开始 |
| `agent-finish` | `reason`, `usage`, `text`；失败时 `error` | 任务结束，前端重新读取会话 |

工具结果 `output` 是 AI SDK 标准结构：`text`、`json`、`error-text`、`execution-denied`、`content`。用户主动停止只发一条 `agent-finish`，`reason` 是 `stopped`。

压缩请求的原生流事件统一带 `request: 'compact'`，必须先分流，不能当成普通回答或停止时的 `partial`。`compact-start` 带 `messages` 和 `startedAt`；`compact-finish.content` 是总结正文，`usage` 已统一成 `input` / `output` / `cacheRead` / `total` / `durationMs`（不再是原始 AI SDK 字段）；`agent-finish.usage` 已包含自动压缩的请求消耗，不要再重复累加。手动压缩调用的是实例 `agent.compact()`，返回的 `content` 仍为字符串；底层 `Agent.compact.run()` 才返回 `{ content, usage }`，二者不混用。

压缩完成后，服务端会把标准化 `usage` 保存到对应的 `compact: true` 历史项（core 中角色为 `user`）。前端统计应同时累计回答与压缩请求，不能把压缩请求的输入 token 当成主模型当前上下文大小。

## 前端打开会话的顺序

```text
1. GET  /session/read/:sessionId?historyLimit=200
2. 用最近一页 history 渲染页面，保留 historyStart/historyTotal
3. 向上滚动时 GET /session/history/:sessionId?before=historyStart，补更早一页
4. GET  /sse/connect/:sessionId
5. 接收仍在运行的流式事件
```

不要让 SSE 负责发送完整 history。断线时先读最近一页会话，再重新连接 SSE；不要发送 `Last-Event-ID`，后端会从当前缓存的第一条事件开始重放。
