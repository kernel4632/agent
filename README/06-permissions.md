# 权限与审批

## 权限级别

| 值 | 行为 |
|---|---|
| `allow` | 直接执行工具 |
| `ask` | 暂停对应 Run，等待用户决定 |
| `deny` | 不执行，将禁止结果返回模型 |

权限属于全局 Environment，全部 Agent 和 Run 共享。

## 配置

简单规则作用于整个工具：

```json
{
  "permissions": {
    "read_file": "allow",
    "write_file": "ask"
  }
}
```

对象规则匹配工具输入对象的第一个参数值：

```json
{
  "permissions": {
    "run_command": {
      "*": "ask",
      "git status*": "allow",
      "git diff*": "allow",
      "rm *": "deny"
    }
  }
}
```

- `*` 匹配任意数量字符，`?` 匹配一个字符。
- 使用全字符串匹配。
- 规则按配置顺序评估，最后一个匹配项生效。
- 对象没有匹配项时为 `ask`。
- 未配置工具时为 `ask`。

## 执行流程

```text
tool-call
-> 读取最新 permissions
-> 匹配工具或首参数规则
-> allow: 执行
-> deny: 不执行，反馈模型
-> ask: Approval.wait
       -> Run = waiting_approval
       -> SSE tool-approval-request
       -> 用户决定
       -> Run = running
       -> 执行、拒绝或持久化权限
```

配置中的 `deny` 返回普通 tool result，让模型尝试其他方案。用户现场选择 `deny` 返回拒绝结果并带 `stop: true`，结束当前循环。

## 审批身份

待审批项使用以下组合键：

```text
runID + toolCallID
```

每项还记录 `sessionID`。决定执行前同时校验 Run、Session 和工具调用归属，防止：

- Child Run 的审批恢复父 Run。
- 使用另一个 Session 的请求消费审批。
- 同一审批被并发请求重复消费。
- 旧兼容 API 在多个匹配项中任选一个。

## 审批 API

```http
POST /chat/approval
```

```json
{
  "sessionId": "ses_xxx",
  "runId": "run_xxx",
  "toolCallId": "call_xxx",
  "decision": "allow-once"
}
```

决定值：

- `deny`：拒绝本次调用。
- `allow-once`：执行本次调用，不改配置。
- `always-allow`：先将整个工具持久化为 `allow`，写盘成功后再执行。

`always-allow` 当前按工具名持久化，不按本次参数规则持久化。写盘失败返回 `500`，审批保持等待，可重试，不会先执行工具。

`runId` 应始终由新客户端提供。省略时按 `sessionId + toolCallId` 兼容查找：

- 唯一匹配：继续处理。
- 多个匹配：返回 `409`，要求 `runId`。
- 无匹配或已消费：返回 `404`。

`POST /chat/approve` 和 `POST /chat/reject` 仅用于旧客户端。

## SSE 请求

```json
{
  "id": "call_xxx",
  "runID": "run_xxx",
  "name": "write_file",
  "args": { "path": "src/app.js" },
  "matchedRule": "*",
  "scope": "argument",
  "target": "src/app.js"
}
```

前端必须把审批弹窗绑定到 `runID`，提交后禁用按钮，直到 API 返回结果。

## 取消与清理

审批等待监听 Run 的 `AbortSignal`。停止 Run、父 Run 取消或请求断开时，等待 Promise 自动按 `deny` 恢复并从 pending map 删除，不留下挂起执行。

待审批项只存在于进程内，不持久化。Server 重启后旧 Run 和审批都不可恢复。
