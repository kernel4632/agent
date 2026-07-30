# SSE 事件协议

## 连接方式

前端通过 EventSource 或 fetch + ReadableStream 连接 SSE 流：

```
POST /chat/send → 响应 Content-Type: text/event-stream
```

## 事件格式

每条 SSE 消息格式：

```
event: <事件类型>
data: <JSON 数据>

```

## 事件类型完整列表

### 思考过程（reasoning）

前端收到这组事件时创建折叠块，默认折叠状态。

| 事件 | 数据 | 说明 |
|------|------|------|
| `reasoning-start` | `{}` | thinking 块开始 |
| `reasoning-delta` | `{ "text": "让我分析..." }` | thinking 增量文本 |
| `reasoning-end` | `{}` | thinking 块结束 |

### 正文输出（text）

| 事件 | 数据 | 说明 |
|------|------|------|
| `text-start` | `{}` | 正文输出开始 |
| `text-delta` | `{ "text": "根据分析..." }` | 正文增量文本 |
| `text-end` | `{}` | 正文输出结束 |

### 工具调用（tool）

| 事件 | 数据 | 说明 |
|------|------|------|
| `tool-call` | `{ "id": "tc_001", "name": "read_file", "args": { "path": "./app.js" } }` | LLM 决定调用工具 |
| `tool-approval-request` | `{ "id": "tc_001", "name": "write_file", "args": { "path": "...", "content": "..." } }` | 等待用户确认（权限为 ask） |
| `tool-result` | `{ "id": "tc_001", "name": "read_file", "result": "...", "step": 3 }` | 工具执行完成，step 为存档点编号 |
| `tool-denied` | `{ "id": "tc_001", "name": "rm_file", "reason": "deny" }` | 工具被权限系统拒绝 |

### 会话事件

| 事件 | 数据 | 说明 |
|------|------|------|
| `session-created` | `{ "id": "ses_xxx" }` | 自动创建了新会话 |
| `session-title` | `{ "title": "重构登录模块" }` | 异步生成的会话标题 |

### 错误与重试

| 事件 | 数据 | 说明 |
|------|------|------|
| `error` | `{ "message": "API 请求超时", "retrying": true, "attempt": 3, "nextRetryIn": 8000 }` | 错误发生，正在重试 |

### 循环结束

| 事件 | 数据 | 说明 |
|------|------|------|
| `done` | `{ "reason": "tool-signaled", "totalSteps": 5, "tokenUsage": { "input": 3200, "output": 850 } }` | 循环正常结束 |

`reason` 可能的值：
- `tool-signaled` — 工具返回 stop:true
- `text-only` — 连续纯文本输出后自然结束
- `user-stopped` — 用户手动中断

## 前端处理示例

```javascript
const eventSource = new EventSource('/chat/send', {
  method: 'POST',
  body: JSON.stringify({ sessionId, message })
})

// 或使用 fetch + ReadableStream
const response = await fetch('/chat/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sessionId, message })
})

const reader = response.body.getReader()
const decoder = new TextDecoder()

while (true) {
  const { done, value } = await reader.read()
  if (done) break

  const text = decoder.decode(value)
  // 解析 SSE 事件...
}
```

## SSE 事件时序示例

一次完整的 Agent 交互：

```
← event: session-created
← data: {"id":"ses_abc"}

← event: reasoning-start
← data: {}

← event: reasoning-delta
← data: {"text":"用户想要读取文件，我需要先查看文件内容..."}

← event: reasoning-end
← data: {}

← event: text-start
← data: {}

← event: text-delta
← data: {"text":"好的，让我先读取文件内容。"}

← event: text-end
← data: {}

← event: tool-call
← data: {"id":"tc_001","name":"read_file","args":{"path":"./app.js"}}

← event: tool-result
← data: {"id":"tc_001","name":"read_file","result":"import express...","step":1}

← event: session-title
← data: {"title":"读取 app.js"}

← event: reasoning-start
← data: {}

← event: reasoning-delta
← data: {"text":"文件读取成功，现在我需要修改..."}

← event: reasoning-end
← data: {}

← event: tool-call
← data: {"id":"tc_002","name":"write_file","args":{"path":"./app.js","content":"..."}}

← event: tool-approval-request
← data: {"id":"tc_002","name":"write_file","args":{"path":"./app.js","content":"..."}}

... (等待用户确认) ...

→ POST /chat/approve {"sessionId":"ses_abc","toolCallId":"tc_002"}

← event: tool-result
← data: {"id":"tc_002","name":"write_file","result":"文件已写入","step":2}

← event: tool-call
← data: {"id":"tc_003","name":"task_done","args":{"summary":"已完成文件修改"}}

← event: tool-result
← data: {"id":"tc_003","name":"task_done","result":"已完成文件修改","step":3}

← event: done
← data: {"reason":"tool-signaled","totalSteps":3,"tokenUsage":{"input":2100,"output":450}}
```
