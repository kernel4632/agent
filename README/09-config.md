# 配置文件结构

## 文件位置

```
~/.agent/config.json
```

## 完整结构

```json
{
  "activeProvider": "anthropic",
  "activeModel": "[REDACTED]",

  "providers": {
    "anthropic": {
      "apiKey": "sk-ant-xxx",
      "baseURL": null,
      "models": [
        "[REDACTED]",
        "[REDACTED]"
      ]
    },
    "openai": {
      "apiKey": "sk-xxx",
      "baseURL": null,
      "models": [
        "gpt-4o",
        "o3-mini",
        "gpt-4.1"
      ]
    },
    "deepseek": {
      "apiKey": "sk-xxx",
      "baseURL": "https://api.deepseek.com",
      "models": [
        "deepseek-chat",
        "deepseek-reasoner"
      ]
    },
    "ollama": {
      "apiKey": null,
      "baseURL": "http://localhost:11434",
      "models": [
        "qwen2.5:32b",
        "deepseek-r1:14b"
      ]
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
    "task_done": "allow"
  }
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

### providers 中每个供应商

| 字段 | 类型 | 说明 |
|------|------|------|
| `apiKey` | string \| null | API 密钥，null 表示不需要（如 ollama） |
| `baseURL` | string \| null | 自定义 API 地址，null 使用默认 |
| `models` | string[] | 该供应商可用的模型列表 |

### permissions

详见 06-permissions.md。

## PUT /config 更新行为

更新采用浅合并（shallow merge）：

```javascript
// 请求体
{ "activeModel": "gpt-4o" }

// 效果：只更新 activeModel，其他字段不变
```

```javascript
// 请求体
{ "providers": { "anthropic": { "apiKey": "new-key" } } }

// 效果：替换整个 providers.anthropic 对象
// 注意：不是深合并，是替换该层级
```

## 即时生效

配置修改后立即生效：

- `activeProvider` / `activeModel` 修改 → 下一次 LLM 调用使用新模型
- `systemPrompt` 修改 → 下一次 LLM 调用使用新提示词
- `permissions` 修改 → 下一次工具执行使用新权限规则

如果 Agent 循环正在运行中，这些改动在下一个循环迭代时自动生效。

## 首次运行

首次运行时如果 config.json 不存在，自动生成默认配置（providers 为空，需要用户在 UI 中填写 API Key）。
