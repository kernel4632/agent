# 配置文件结构

## 文件位置

```
~/.agent/config.json
```

## 完整结构

```json
{
  "activeProvider": "openai",
  "activeModel": "gpt-4.1",

  "providers": {
    "openai": {
      "apiKey": "sk-xxx",
      "baseURL": "https://api.openai.com/v1",
      "protocol": "openai-responses",
      "headers": {},
      "timeoutMs": 120000,
      "cache": { "enabled": true, "mode": "implicit" },
      "models": ["gpt-4.1"],
      "modelSettings": {
        "gpt-4.1": {
          "context": 1048576,
          "maxOutputTokens": 32768,
          "temperature": 0.2
        }
      }
    }
  },

  "systemPrompt": "你是一个有用的 AI 助手，能够通过调用工具来帮助用户完成各种任务。",

  "permissions": {
    "read_file": "allow",
    "write_file": "ask",
    "run_command": {
      "*": "ask",
      "git log*": "allow",
      "git diff*": "allow",
      "git status*": "allow",
      "git show*": "allow",
      "ls *": "allow",
      "cat *": "allow",
      "npm *": "allow",
      "bun *": "allow",
      "rm *": "deny",
      "sudo *": "deny"
    },
    "list_files": "allow",
    "search_files": "allow",
    "web_fetch": "allow",
    "task_done": "allow",
    "task_list_update": "allow"
  },
  "modelLimits": {}
}
```

## 字段说明

### 顶层字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `activeProvider` | string | 当前使用的供应商名称 |
| `activeModel` | string | 当前使用的模型名称 |
| `providers` | object | 所有已配置的供应商 |
| `systemPrompt` | string | 系统提示词 |
| `permissions` | object | 工具权限配置 |
| `modelLimits` | object | 旧版按模型名称保存的上下文限制；新配置优先使用 `modelSettings` |

### providers 中每个供应商

| 字段 | 类型 | 说明 |
|------|------|------|
| `apiKey` | string \| null | API 密钥，null 表示不需要（如 ollama） |
| `baseURL` | string \| null | 自定义 API 地址，null 使用默认 |
| `protocol` | string | `openai-responses` 或 `openai-compatible`，显式决定调用协议 |
| `headers` | object | 应用于该供应商请求的自定义 HTTP 请求头 |
| `timeoutMs` | number | 请求及响应流超时时间，单位毫秒，默认 120000 |
| `cache` | object | Responses 协议缓存设置：`enabled` 与 `mode` |
| `models` | string[] | 该供应商可用的模型列表 |
| `modelSettings` | object | 按模型名配置 `context`、`maxOutputTokens` 和 `temperature` |

### permissions

详见 06-permissions.md。

## PUT /config 更新行为

普通字段采用深度合并；只更新传入的字段：

```javascript
// 请求体
{ "activeModel": "gpt-4o" }

// 效果：只更新 activeModel，其他字段不变
```

```javascript
// 请求体
{ "providers": { "openai": { ...完整供应商配置... } } }

// providers 是例外：传入时按完整集合替换，以支持删除供应商
```

`GET /config` 会将 API Key 以及名称匹配 authorization、token、cookie、secret 等模式的敏感请求头替换为 `[REDACTED]`。把未修改的占位符原样提交回 `PUT /config` 时，服务端会恢复已保存的真实值。

## 即时生效

配置修改后立即生效：

- `activeProvider` / `activeModel` 修改 → 下一次 LLM 调用使用新模型
- `systemPrompt` 修改 → 下一次 LLM 调用使用新提示词
- `permissions` 修改 → 下一次工具执行使用新权限规则
- `timeoutMs` / `headers` / `cache` / `modelSettings` 修改 → 下一次 LLM 调用使用新请求设置

如果 Agent 循环正在运行中，这些改动在下一个循环迭代时自动生效。

## 首次运行

首次运行时如果 config.json 不存在，自动生成默认配置（providers 为空，需要用户在 UI 中填写 API Key）。
