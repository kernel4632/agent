# 存档点与回滚

## 设计思路

参考 Roo Code 的工具粒度存档机制：每次工具执行完成后自动保存一个存档点。用户可以在 UI 中直接在任意工具调用旁边点击"回退到这里"，精确回滚到该步骤。

## 存档点定义

每个存档点 = 某次工具执行完成后的会话快照。存档点信息随 SSE 事件推送给前端，前端本地持有，不需要额外查询接口。

## 代码归属

存档和回滚不单独设模块。保存存档点在 commands/chat.js 的循环中完成（工具执行后写入 step 标记并持久化），回滚操作在 commands/session.js 的 rollback 方法中完成（截断 messages 数组）。数据全部存在 store/sessions.js 的会话结构里。

## 数据结构

### 消息历史中的步骤标记

```javascript
// 会话消息历史
messages: [
  { role: "user", content: "帮我重构登录模块" },
  { role: "assistant", content: "...", toolCalls: [{ id: "tc_001", name: "read_file", args: {...} }] },
  { role: "tool", toolCallId: "tc_001", name: "read_file", result: "...", step: 1 },    // ← 存档点 1
  { role: "assistant", content: "...", toolCalls: [{ id: "tc_002", name: "write_file", args: {...} }] },
  { role: "tool", toolCallId: "tc_002", name: "write_file", result: "...", step: 2 },   // ← 存档点 2
  { role: "assistant", content: "...", toolCalls: [{ id: "tc_003", name: "run_command", args: {...} }] },
  { role: "tool", toolCallId: "tc_003", name: "run_command", result: "...", step: 3 },  // ← 存档点 3
  { role: "assistant", content: "最终回复" }
]
```

`step` 字段就是存档点编号，从 1 递增。

### 并行工具调用的步骤

当一次 LLM 调用产生多个 tool\_call 时，不共享同一个 step 编号：

```javascript
// LLM 一次调用了 3 个工具
{ role: "tool", toolCallId: "tc_004", name: "read_file", result: "...", step: 4 },
{ role: "tool", toolCallId: "tc_005", name: "read_file", result: "...", step: 5 },
{ role: "tool", toolCallId: "tc_006", name: "read_file", result: "...", step: 6 },
// 三个工具编号不一样
```

## 保存时机

存档点在工具执行完成后保存：

保存内容：将当前完整消息历史写入持久化存储。

## 回滚操作

### API

```
POST /session/:id/rollback/:step
```

### 行为

1. 找到消息历史中 `step` 等于指定值的 tool 消息
2. 截断该消息之后的所有消息（保留该 tool 消息本身）
3. 持久化更新后的消息历史
4. 暂时留存后面的消息存档，用户可以撤销回退，下一次消息发送时删除

### 示例

当前有 8 条消息，用户点击存档点 1 的回滚按钮：

```
POST /session/ses_xxx/rollback/1
```

服务端找到 step=1 的 tool 消息（第 3 条），截断第 4 条及以后的所有消息。会话回到只有前 3 条消息的状态。

用户之后发送新消息时，Agent 从这个点继续。

## 前端展示

每个工具调用结果旁边显示一个存档点标记：

```
┌─────────────────────────────────────┐
│  🔧 read_file("./src/app.js")       │
│  结果: import express from...        │
│                          [⟲ 回退]   │  ← 存档点按钮
├─────────────────────────────────────┤
│  🔧 write_file("./src/app.js")      │
│  结果: 文件已写入                     │
│                          [⟲ 回退]   │
├─────────────────────────────────────┤
│  🔧 run_command("npm test")          │
│  结果: All tests passed              │
│                          [⟲ 回退]   │
└─────────────────────────────────────┘
```

点击任意"回退"按钮 → 调用 POST /session/:id/rollback/:step → 刷新消息列表。

## 存储方式

会话数据和存档点以 JSON 文件形式存储在本地：

```
~/.agent/sessions/
├── ses_a1b2c3.json    # 会话完整数据（含消息历史）
├── ses_d4e5f6.json
└── ...
```

回滚操作直接修改该 JSON 文件中的 messages 数组。
