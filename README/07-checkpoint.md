# 存档点与回滚

## 设计思路

参考 Roo Code 的工具粒度回退机制：每次工具执行完成后标记一个步骤号。用户可以在 UI 中直接在任意工具调用旁边点击"回退到这里"，精确回滚到该步骤。

存档点不需要单独存储，它本质是展示历史与模型历史中的同步截断位置。回退先暂存被截断内容，用户发送新消息时才正式提交分支。

## 代码归属

回滚操作在 `server/commands/session.js` 的 rollback 方法中完成（截断 messages 数组 + 临时保留截断数据）。数据全部在 `server/store.js` 的 `store.sessions` 结构里。

## 数据结构

### 消息历史中的步骤标记

```javascript
messages: [
  { role: "user", content: "帮我重构登录模块" },
  { role: "assistant", content: "...", toolCalls: [{ id: "tc_001", name: "read_file", args: {...} }] },
  { role: "tool", toolCallId: "tc_001", name: "read_file", result: "...", step: 1 },    // ← 步骤 1
  { role: "assistant", content: "...", toolCalls: [{ id: "tc_002", name: "write_file", args: {...} }] },
  { role: "tool", toolCallId: "tc_002", name: "write_file", result: "...", step: 2 },   // ← 步骤 2
  { role: "assistant", content: "...", toolCalls: [{ id: "tc_003", name: "run_command", args: {...} }] },
  { role: "tool", toolCallId: "tc_003", name: "run_command", result: "...", step: 3 },  // ← 步骤 3
  { role: "assistant", content: "最终回复" }
]
```

`step` 字段就是回退标记，从 1 递增。

### 并行工具调用的步骤

当一次 LLM 调用产生多个 tool_call 时，所有工具共享同一个 step 编号：

```javascript
{ role: "tool", toolCallId: "tc_004", name: "read_file", result: "...", step: 4 },
{ role: "tool", toolCallId: "tc_005", name: "read_file", result: "...", step: 4 },
{ role: "tool", toolCallId: "tc_006", name: "read_file", result: "...", step: 4 },
// 三个工具都属于步骤 4
```

## 回滚操作

### API

```
POST /session/:id/rollback/:step
```

### 行为

1. 找到消息历史中 `step` 等于指定值的最后一条 tool 消息
2. 将该消息之后的所有消息截断
3. 截断的展示消息和模型消息临时保留在 session 的 `rollbackCache` 字段中
4. 用户可以撤销回退（同时恢复 `rollbackCache` 中的展示历史和模型历史）
5. 用户下一次发送消息时，清空 `rollbackCache`（回退正式生效，无法再撤销）

### 回退用户消息并重发

用户消息使用稳定 `id`。点击用户消息旁的编辑动作后，前端调用：

```
POST /session/:id/rollback-message
{ "messageId": "msg_xxx" }
```

Server 从目标用户消息之前同步暂存展示历史和模型历史，前端把该消息原文恢复到输入框。用户可以修改后发送形成新分支，也可以点击“撤销回退”恢复原历史。该流程参考 OpenCode 的 staged revert，而不是直接覆盖旧消息。

### 数据流示例

```javascript
// 回滚前
session = {
  messages: [msg1, msg2, msg3, msg4, msg5, msg6, msg7, msg8],
  rollbackCache: null
}

// POST /session/ses_xxx/rollback/1（回滚到步骤 1，即 msg3 是 step:1 的 tool 消息）
session = {
  messages: [msg1, msg2, msg3],
  rollbackCache: { messages: [msg4, msg5, msg6, msg7, msg8], modelMessages: [...] } // 临时保留
}

// 用户撤销回退
session = {
  messages: [msg1, msg2, msg3, msg4, msg5, msg6, msg7, msg8],  // 恢复
  rollbackCache: null
}

// 或者用户发送新消息（/chat/send）
session = {
  messages: [msg1, msg2, msg3, newUserMsg, ...],   // 从回滚点继续
  rollbackCache: null                               // 清空，无法再撤销
}
```

## 前端展示

每个工具调用结果旁边显示一个回退按钮：

```
┌─────────────────────────────────────┐
│  🔧 read_file("./src/app.js")       │
│  结果: import express from...        │
│                          [⟲ 回退]   │
├─────────────────────────────────────┤
│  🔧 write_file("./src/app.js")      │
│  结果: 文件已写入                     │
│                          [⟲ 回退]   │
└─────────────────────────────────────┘
```

回退后，前端显示被截断的消息变灰或隐藏，并出现"撤销回退"按钮。用户发送新消息后该按钮消失。

## 持久化

会话以 JSON 文件存储在 `~/.agent/sessions/ses_xxx.json`。每次工具执行完成后即时写入磁盘（覆写整个文件），确保进程崩溃后可从最后一个步骤恢复。

`rollbackCache` 也持久化在同一个文件中（如果存在的话）。会话 API 仅返回回退数量与目标摘要，不返回隐藏的完整历史。
