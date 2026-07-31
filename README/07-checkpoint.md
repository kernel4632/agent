# 存档点与回退

## 目的

工具执行完成后形成可回退步骤。回退同时作用于前端展示历史和模型协议历史，并先进入可撤销状态；用户发送下一条消息后才正式丢弃旧分支。

回退只修改 Session，不回滚工具已经产生的文件、命令、网络或外部系统副作用。它是对话历史分支，不是工作区事务。

## 步骤

一轮模型调用产生的全部工具结果共享同一个递增 `step`：

```javascript
{ role: 'tool', toolCallId: 'call_a', step: 4, result: {} }
{ role: 'tool', toolCallId: 'call_b', step: 4, result: {} }
```

Server 持久化本轮消息后发送：

```text
event: checkpoint
data: {"step":4,"toolCallIds":["call_a","call_b"]}
```

## 回退到工具步骤

```http
POST /session/:id/rollback/:step
```

行为：

1. 如果已有暂存回退，先恢复完整历史，允许移动边界。
2. 找到该 `step` 最后一条 tool 消息，保留同一步骤的全部工具结果。
3. 在 `modelMessages` 中定位对应 tool call 的结果边界。
4. 同步截断两套历史。
5. 把截断部分写入 `rollbackCache` 并持久化。

响应：

```json
{ "ok": true, "remainingMessages": 12 }
```

## 回退用户消息

用户消息拥有稳定 `messageId`：

```http
POST /session/:id/rollback-message
```

```json
{ "messageId": "msg_xxx" }
```

目标用户消息及其后历史会被暂存，响应返回原文：

```json
{
  "ok": true,
  "remainingMessages": 5,
  "content": "原用户消息"
}
```

前端把 `content` 恢复到输入框。再次发送会形成新分支。

## 撤销与提交

撤销：

```http
POST /session/:id/undo-rollback
```

```json
{ "ok": true, "restoredMessages": 7 }
```

下一次 `POST /chat/send` 在追加用户消息前调用 `commitRollback()`，清空缓存并正式提交分支。提交后不能通过该 API 恢复旧历史。

## 持久化结构

```javascript
session.rollbackCache = {
  messages: [],
  modelMessages: [],
  target: {
    type: 'checkpoint',
    step: 4
  }
}
```

用户消息回退的 `target` 为：

```javascript
{
  type: 'message',
  messageID: 'msg_xxx',
  content: '原用户消息'
}
```

完整缓存随 Session 写入磁盘。`GET /session/:id` 不泄漏隐藏历史，只返回：

```json
{
  "rollback": {
    "count": 7,
    "target": { "type": "checkpoint", "step": 4 }
  }
}
```

## 并发约束

运行中的 Session 不允许工具回退、用户消息回退、撤销回退或删除，避免与根 Run 同时修改历史。Routes 使用 `Chat.isRunning(sessionID)` 检查该约束。

Child Run 不直接写入 Session 模型历史，因此不会单独产生 Session checkpoint；父 Run 的 `spawn_agent` tool result 作为父模型轮次的一部分形成回退点。

## 旧数据兼容

Session 加载时为旧消息补齐稳定 ID、`modelMessages`、任务和 Agent 字段。旧版数组形式 `rollbackCache` 仍可撤销，但只能恢复展示历史；新写入统一使用双历史对象结构。
