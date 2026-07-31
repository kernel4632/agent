# Agent 执行循环

## 根 Run

`POST /chat/send` 的执行链：

```text
校验或创建 Session
-> 拒绝同 Session 的并发根 Run
-> 创建 Run 和 Agent 快照
-> 发送 session-created / run-created
-> 追加用户消息
-> 构造模型上下文
-> 调用模型并流式发送事件
-> 执行工具或结束
-> 持久化 Session
-> 完成、失败或取消 Run
```

根循环位于 `server/commands/chat.js`。Run 创建时解析 Agent，此后全局默认 Agent 或 Provider 配置变化不会切换当前 Run 的模型身份。

## 模型上下文

每轮请求由以下内容构成：

```text
Agent systemPrompt
+ 当前时间和工作区说明
+ Skills 渐进披露说明
+ Session modelMessages 的压缩副本
+ 统一工具注册表
```

展示消息 `messages` 和模型消息 `modelMessages` 分开保存。上下文裁剪只作用于模型请求副本。

## 流处理

AI SDK `streamText()` 的事件被映射为 SSE：

- `text-delta` -> `text-delta`
- `reasoning-delta` -> `reasoning-delta`
- `tool-call` -> 工具执行和 `tool-call` / `tool-result`
- 错误 -> `error` 或有限重试
- 正常结束 -> `done`

模型输出为空文本、空 reasoning 且没有工具调用时，按 `503` 可恢复错误处理，防止把无内容轮次误判为成功。

## 工具轮次

```text
model tool-call
-> Tool.execute
-> Permission.evaluate
-> allow: 执行工具
-> ask: Run 进入 waiting_approval
-> deny: 返回拒绝结果
-> 写入 tool result
-> 下一轮模型调用
```

同一模型轮次返回多个工具调用时共享同一 `step`，用于历史回退。

根 Run 没有固定工具步数上限，但始终受 Run 总时限、单轮模型时限、有限重试和用户取消约束，因此不是无限循环。

## Child Run

Agent 调用内置 `spawn_agent` 时：

```text
父工具调用
-> 创建 parentRunID 指向父 Run 的 Child Run
-> 发送 child-run-created
-> Child Run 使用目标 Agent 的独立模型上下文
-> 共享工具、权限、MCP、LSP、Skills 和工作区
-> 最多执行 8 个模型轮次
-> 结果作为 spawn_agent 工具结果返回父 Agent
-> 发送 child-run-finished
```

约束：

- 最大 Child Run 深度为 4。
- 子 Run 必须与父 Run 属于同一 Session。
- 父 Run 取消会递归取消所有后代。
- Child Run 不直接写入父 Session 的模型历史；父 Agent 只接收最终工具结果。
- Child Run 审批携带自身 `runID`，不会误消费父 Run 审批。

## 重试与时间预算

模型调用使用 `server/utils/retry.js`：

- 默认最多重试 3 次。
- 默认单次模型轮次预算为 `120000ms`。
- 默认根 Run / Child Run 总预算为 `runTimeoutMs = 300000ms`。
- 重试采用指数退避，并受剩余时间预算限制。
- HTTP `408`、`429`、全部 `5xx` 和网络瞬断可重试。
- 请求校验、权限拒绝、模型协议错误和用户取消不盲目重试。

当模型轮次预算耗尽时产生不可恢复超时；根 Run 总预算通过取消信号结束，Child Run 总预算作为失败结果返回父 Agent。所有路径都会释放对应运行资源。重试是容错机制，不是无限等待机制。

## 取消

每个 Run 有独立 `AbortController`。取消来源包括：

- `POST /run/:id/stop`
- `POST /chat/stop`
- 父 Run 取消传播
- HTTP 请求断开
- Run 时间预算耗尽

终态只写入一次，后续完成或失败回调不能覆盖 `cancelled`。

## 结束条件

Run 在以下情况结束：

- 模型产生最终文本且不再调用工具：`completed`
- Child Run 返回最终结果：`completed`
- 模型、工具或持久化产生不可恢复错误：`failed`
- 用户或父 Run 中止：`cancelled`
- 根 Run 总预算耗尽：`cancelled`，错误原因记录为 run timeout
- Child Run 总预算耗尽：`failed`，失败结果返回父 Agent

无论结果如何，都必须清理审批等待项和 Session 运行锁，并发送终态反馈。
