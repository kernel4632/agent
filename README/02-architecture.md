# 运行架构

## 当前架构

```text
Vue Workbench
  | HTTP + POST SSE
  v
Elysia Routes
  | 触发业务动作
  v
Commands
  | 修改或读取
  +--> Store
  +--> Session Storage
  +--> Model Provider
  +--> Tools / MCP / LSP / Skills
  |
  v
JSON / SSE / Disk Feedback
```

`server/server.js` 只启动 Runtime、组合路由和监听端口。业务规则不写在入口中。

## 服务端分层

### Routes

`server/routes/` 是 HTTP 触发层：

| 路由模块 | 责任 |
|---|---|
| `agent.js` | Agent 目录、创建和更新 |
| `chat.js` | 发送消息、停止和审批入口 |
| `session.js` | Session、任务和历史回退 |
| `run.js` | Run 查询和精确停止 |
| `tool.js` | 工具目录和重载 |
| `capability.js` | MCP、LSP、Skills 状态和重载 |
| `config.js` | 脱敏配置、保存和 Provider 测试 |

Routes 只做请求校验、Command 调用和 HTTP 响应转换。

### Commands

`server/commands/` 是业务动作层：

| Command | 责任 |
|---|---|
| `agent.js` | Agent 定义、默认选择和 Run 快照 |
| `approval.js` | 审批等待、归属校验和决定消费 |
| `chat.js` | 根/子 Agent 循环和 SSE 编排 |
| `run.js` | Run 状态、父子索引和取消传播 |
| `session.js` | Session 数据、任务、回退和持久化 |
| `config.js` | 配置、Provider 和模型实例 |
| `tool.js` | 工具扫描、注册和 watcher |
| `mcp.js` | MCP 连接和动态工具 |
| `lsp.js` | LSP 进程和代码工具 |
| `skill.js` | Skill 发现和渐进披露 |

### Store

`server/store.js` 是唯一进程级状态根：

```text
store
  agents.definitions
  config.value / filePath
  tools.items / watcher / directories
  capabilities.mcp / lsp / skills
  sessions.items / writes / storage
  runs.items / bySession / byParent
```

Routes 不直接修改 Store；每个领域由对应 Command 修改。

## Agent、Session、Run 与 Environment

```text
Shared Environment
  permissions + tools + MCP + LSP + Skills + workspace

Session
  +-- Root Run (Agent A)
        +-- Child Run (Agent B)
        +-- Child Run (Agent C)
              +-- Child Run (Agent D)
```

- Agent 是静态模型选择，不拥有工具或工作区。
- Session 保存长期用户数据，不等于一次执行。
- Run 保存瞬时执行状态，进程重启后清空。
- Child Run 使用独立模型消息历史，但共享 Environment。
- 同一 Session 同时只允许一个根 Chat Run；不同 Session 可以并行。
- Child Run 最大深度为 4，单个 Child Run 最多执行 8 个模型轮次。

## Runtime 生命周期

`server/runtime.js` 按依赖顺序启动：

```text
创建数据目录
-> 加载 Config
-> 加载 Agent
-> 清空不可恢复 Run
-> 恢复 Session
-> 加载并监听 Tools
-> 加载 Skills
-> 连接 MCP 和 LSP
```

关闭顺序：

```text
MCP + LSP -> Tool watcher
```

初始化任一步骤失败时，Runtime 会执行同一关闭路径，释放已经启动的 watcher、连接和子进程。`server/test/runtime.test.js` 使用故障注入验证该行为。

## Run 生命周期

```text
queued -> running -> waiting_approval -> running
                   |                    |
                   +--------------------+
running / waiting_approval -> completed | failed | cancelled
```

每个 Run 拥有：

- `runID`、`sessionID`、`agentID` 和 `parentRunID`
- `status`、`input`、`result` 和 `error`
- 创建、开始和结束时间
- 独立 `AbortController`
- 默认 5 分钟总执行预算

父 Run 取消会递归中断所有后代 Run。

## 通信

- 普通资源操作使用 JSON HTTP。
- `/chat/send` 使用 `fetch()` 发起 POST，并读取 `text/event-stream`。
- 前端通过 `frontend/src/utils/sse.js` 手动解析 SSE，不使用 `EventSource`。
- AI SDK 流事件与业务事件使用同一个 SSE 通道。

## 开发模式

```bash
cd server
bun run server.js

cd frontend
bun run dev
```

Server 默认从 `4632` 开始寻找可用端口；Vite 开发代理连接 Server。

## 未来分发布局

Go/Wails 和 BubbleTea 是未来宿主，不改变 Server 的领域架构：

```text
Wails Desktop ----+
                  +--> Agent Server HTTP + SSE
BubbleTea CLI ----+
```

宿主只负责进程生命周期、窗口和终端交互，不直接访问 Store 或执行工具。
