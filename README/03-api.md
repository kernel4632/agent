# API 接口设计

共 14 个接口。Agent Server 基于 Elysia 框架，默认监听 `127.0.0.1:4632`（端口被占用时自动 +1 直到可用）。

全部路由在 `server/server.js` 入口中声明式注册，直接调用 `server/commands/` 中的对应指令。

## 对话

### POST /chat/send

发送消息，启动 Agent 循环。响应为 SSE 流。

```
请求体:
{
  "sessionId": "ses_xxx",   // 可选，不传则自动创建新会话
  "message": "帮我写一个排序函数"
}

响应: text/event-stream (SSE 流)
```

### POST /chat/stop

中断当前正在执行的 Agent 循环。

```
请求体:
{
  "sessionId": "ses_xxx"
}

响应:
{ "ok": true }
```

### POST /chat/approve

批准工具执行（当工具权限为 ask 时，循环暂停等待此请求）。

```
请求体:
{
  "sessionId": "ses_xxx",
  "toolCallId": "tc_001"
}

响应:
{ "ok": true }
```

### POST /chat/reject

拒绝工具执行。Agent 会告知 LLM 该工具被用户拒绝，并停止 Agent 循环。

```
请求体:
{
  "sessionId": "ses_xxx",
  "toolCallId": "tc_001"
}

响应:
{ "ok": true }
```

## 会话

### POST /session/create

创建新的空会话。

```
请求体: 无

响应:
{
  "id": "ses_a1b2c3",
  "title": "",
  "createdAt": 1722345678000
}
```

### GET /session/list

获取所有会话列表（不含完整消息历史，只含摘要信息）。

```
响应:
[
  {
    "id": "ses_a1b2c3",
    "title": "重构登录模块",
    "createdAt": 1722345678000,
    "updatedAt": 1722345900000,
    "messageCount": 12
  }
]
```

### GET /session/:id

获取单个会话完整详情，含所有消息历史。

```
响应:
{
  "id": "ses_a1b2c3",
  "title": "重构登录模块",
  "createdAt": 1722345678000,
  "updatedAt": 1722345900000,
  "messages": [
    { "role": "user", "content": "帮我重构登录模块" },
    { "role": "assistant", "content": "...", "reasoning": "...", "toolCalls": [...] },
    { "role": "tool", "toolCallId": "tc_001", "name": "read_file", "result": "...", "step": 1 },
    ...
  ]
}
```

### DELETE /session/:id

删除会话。

```
响应:
{ "ok": true }
```

### POST /session/:id/rollback/:step

回滚到指定步骤。截断该步骤之后的所有消息，截断内容临时保留供撤销。

```
响应:
{
  "ok": true,
  "remainingMessages": 5
}
```

### POST /session/:id/undo-rollback

撤销上一次回滚操作。将临时保留的截断消息恢复回来。仅在未发送新消息前可用。

```
响应（成功）:
{
  "ok": true,
  "restoredMessages": 3
}

响应（无可撤销的回滚）:
{
  "ok": false,
  "error": "no rollback to undo"
}
```

## 工具

### GET /tool/list

获取所有已加载工具的完整信息。

```
响应:
[
  {
    "name": "read_file",
    "description": "读取指定路径的文件内容",
    "parameters": {
      "path": { "type": "string", "description": "文件路径", "required": true }
    },
    "source": "built-in"
  },
  {
    "name": "search_web",
    "description": "搜索互联网获取最新信息",
    "parameters": {
      "query": { "type": "string", "description": "搜索关键词", "required": true },
      "limit": { "type": "number", "description": "返回结果数量", "default": 5 }
    },
    "source": "custom"
  }
]
```

### POST /tool/reload

手动触发工具全量重载（扫描 tools/ 目录重新加载）。

```
响应:
{
  "ok": true,
  "loaded": 8,
  "errors": []
}
```

## 配置

### GET /config

获取完整配置。

```
响应:
{
  "activeProvider": "anthropic",
  "activeModel": "[REDACTED]",
  "providers": { ... },
  "systemPrompt": "...",
  "permissions": { ... }
}
详见 09-config.md
```

### PUT /config

更新配置（局部合并，只传需要修改的字段）。

```
请求体（示例：切换模型）:
{ "activeModel": "[REDACTED]" }

请求体（示例：修改权限）:
{ "permissions": { "write_file": "allow" } }

请求体（示例：更新系统提示词）:
{ "systemPrompt": "你是一个专业的..." }

响应:
{ "ok": true }
```

PUT /config 的修改即时生效。如果当前正在执行 Agent 循环，下一次 LLM 调用将使用新配置（模型切换即时生效）。
