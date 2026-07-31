# Agent 项目概述

## 定位

这是一个以 Bun Agent Server 为核心的本地 AI Agent 工作台。用户通过对话驱动 Agent 调用工具、MCP、LSP 和 Skills 完成任务，并可在同一工作区中运行多个 Agent、多个 Session 和多级 Child Run。

当前可运行形态是 Vue 3 浏览器工作台 + Bun/Elysia Server。Go/Wails 桌面壳和 BubbleTea CLI 属于后续分发规划，不是当前仓库已经实现的运行入口。

## 当前能力

- 多 Agent 定义：每个 Agent 选择名称、Provider、模型和系统提示词。
- 共享执行环境：所有 Agent 共用权限、工具注册表、MCP、LSP、Skills 和工作区。
- Session 持久化：用户对话、任务清单、标题和回退数据写入磁盘。
- Run 生命周期：每次执行都有独立 Run ID、状态、取消信号和时间预算。
- Child Run 协作：模型可通过 `spawn_agent` 派生子 Agent，最大深度为 4。
- 父子取消传播：停止父 Run 会递归停止全部 Child Run。
- 工具权限：支持 `allow`、`ask`、`deny` 和按首个参数匹配的通配规则。
- Run 级审批：审批事件带 Run 归属，可区分同一 Session 中的多个 Child Run。
- SSE 反馈：文本、推理、工具调用、审批、Run 树、任务清单和重试状态实时更新。
- 有限重试：可恢复错误使用指数退避，但受次数和时间预算约束。
- Run 总时限：根 Run 和 Child Run 默认最多运行 5 分钟，可通过配置调整。
- 上下文裁剪：只裁剪发送给模型的副本，不影响展示历史和持久化历史。
- 工具热重载：内置工具随 Server 分发，自定义工具从用户数据目录加载。
- 外部能力：MCP、LSP 和 Agent Skills 进入统一工具注册表。
- 工具步骤回退：展示历史和模型历史同步暂存，支持撤销或形成新分支。

## 核心概念

| 概念 | 责任 |
|---|---|
| Agent | 固定一次 Run 使用的 Provider、模型和系统提示词 |
| Session | 保存长期对话历史、任务清单和回退数据 |
| Run | 表示一次 Agent 执行，拥有状态、时间和取消边界 |
| Child Run | 父 Run 派生的独立模型上下文，结果返回父 Agent |
| Environment | 全局共享的权限、工具、MCP、LSP、Skills 和工作区 |

## 技术栈

| 层 | 当前技术 | 说明 |
|---|---|---|
| 前端 UI | Vue 3 + JavaScript + MDUI | 浏览器工作台、Agent 配置和 Run 树 |
| Agent Server | Bun + Elysia | HTTP、SSE、状态和资源生命周期 |
| Agent 循环 | Vercel AI SDK | 模型流、工具调用和 Provider 适配 |
| Provider | `@ai-sdk/openai`、`@ai-sdk/openai-compatible` | Responses 和 OpenAI-compatible 协议 |
| 外部能力 | MCP SDK、vscode-jsonrpc、YAML | MCP、LSP 和 Skills |
| 持久化 | unstorage + JSON 文件 | Session 和配置持久化 |

## 运行形态

### 当前实现

1. Bun Server 独立运行，默认监听 `127.0.0.1:4632`。
2. Vue/Vite 前端通过 HTTP + POST SSE 调用 Server。
3. Server、前端和测试使用同一套 Routes、Commands 和 Store。

### 未来布局

1. Go + Wails 桌面壳负责窗口和进程托管。
2. Go + BubbleTea CLI 复用同一个 Agent Server API。
3. Bun Server 编译为可嵌入二进制，由桌面壳统一启动和关闭。

未来客户端不得复制 Agent 业务逻辑，只能消费本 README 定义的 HTTP、SSE 和 Run 协议。

## 设计主线

项目遵循 HOP 数据链路：

```text
触发事件 -> Route -> Command -> Store / External Resource -> SSE / JSON / Disk
```

Agent 只描述模型身份，Environment 始终共享；Session 负责长期数据，Run 负责瞬时执行。四者不能混为一个“上下文对象”。
