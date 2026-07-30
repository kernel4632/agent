# 权限系统设计

## 设计参考

参考 OpenCode 的权限模型，每个工具的执行权限可配置为三个级别，支持通配符模式匹配。

## 权限级别

| 级别      | 行为                       |
| ------- | ------------------------ |
| `allow` | 直接执行，不询问用户               |
| `ask`   | 暂停循环，推送确认请求给前端，等待用户批准或拒绝 |
| `deny`  | 不执行，告知 LLM 该工具被禁止使用      |

## 配置方式

权限配置位于 config.json 的 `permissions` 字段。

### 简单配置（整个工具一个级别）

```json
{
  "permissions": {
    "read_file": "allow",
    "write_file": "ask",
    "list_files": "allow",
    "search_files": "allow",
    "web_fetch": "allow",
    "task_done": "allow"
  }
}
```

### 模式匹配配置（按参数内容细分）

适用于需要按具体操作内容区分权限的工具（如 run\_command）：

```json
{
  "permissions": {
    "run_command": {
      "*": "ask",
      "git *": "allow",
      "npm *": "allow",
      "bun *": "allow",
      "ls *": "allow",
      "cat *": "allow",
      "rm *": "deny",
      "sudo *": "deny"
    }
  }
}
```

## 匹配规则

### 通配符语法

| 符号  | 含义          |
| --- | ----------- |
| `*` | 匹配零个或多个任意字符 |
| `?` | 匹配恰好一个任意字符  |
| 其他  | 字面匹配        |

### 匹配目标

使用工具的**第一个参数值**作为匹配目标。例如 `run_command` 工具的第一个参数是 `command`，就用命令内容做匹配。

### 优先级

规则从上到下逐条匹配，**最后一条匹配的规则生效**。

示例：命令 `git push origin main`

```json
{
  "*": "ask",        // 匹配 ✓（通配符）
  "git *": "allow"   // 匹配 ✓（更具体）→ 最终结果: allow
}
```

示例：命令 `rm -rf /tmp`

```json
{
  "*": "ask",       // 匹配 ✓
  "rm *": "deny"    // 匹配 ✓ → 最终结果: deny
}
```

### 未配置的工具

未在 permissions 中出现的工具默认为 `ask`（需要用户确认）。

## ask 权限的交互流程

当工具权限为 ask 时：

1. Agent 循环暂停
2. 推送 SSE 事件 `tool-approval-request`，携带工具名和参数
3. 前端展示确认弹窗，显示工具名、参数内容
4. 用户选择：
   - 批准 → 前端 POST /chat/approve → 循环继续执行该工具
   - 拒绝 → 前端 POST /chat/reject → 跳过执行，告知 LLM 被拒绝

### 内部实现

使用 Promise 实现暂停/恢复：

```javascript
// 循环中遇到 ask 权限
const approved = await waitForApproval(toolCallId, toolName, args)
if (approved) {
  // 执行工具
} else {
  // 告知 LLM: "用户拒绝了该工具的执行"
}
```

`waitForApproval` 返回一个 Promise，直到收到 `/chat/approve` 或 `/chat/reject` 请求时才 resolve。

## deny 权限的处理

工具被 deny 时，不执行工具，而是将以下消息作为 tool\_result 传回给 LLM：

```
该工具已被用户禁止使用。请尝试其他方式完成任务。
```

LLM 会据此调整策略（比如换一个工具或告知用户无法完成）。如果是用户现场拒绝的直接停止 Agent 循环，如果是自动拒绝的就继续循环。

## 默认权限配置

首次运行时生成的默认配置：

```json
{
  "permissions": {
    "read_file": "allow",
    "write_file": "ask",
    "run_command": {
      "*": "ask",
      "git log*": "allow",
      "git diff*": "allow",
      "git status*": "allow",
      "ls *": "allow"
    },
    "list_files": "allow",
    "search_files": "allow",
    "web_fetch": "allow",
    "task_done": "allow"
  }
}
```

