# 配置

## 位置与加载

默认文件：

```text
~/.agent/config.json
```

Windows 默认是 `%USERPROFILE%\.agent\config.json`。可通过以下方式覆盖：

- `AGENT_DATA_DIR`：覆盖整个用户数据目录。
- `AGENT_WORKSPACE`：覆盖 MCP/LSP/Skills 使用的共享工作区。
- Runtime `configPath`、`dataDirectory`、`workspaceDirectory`：宿主和测试注入。

首次启动会生成配置，并把旧字段归一化后写回磁盘。

## 完整示例

```json
{
  "activeProvider": "openai",
  "activeModel": "gpt-5",
  "systemPrompt": "你是一个有用的 AI 助手。",
  "providers": {
    "openai": {
      "apiKey": "sk-xxx",
      "baseURL": "https://api.openai.com/v1",
      "protocol": "openai-responses",
      "headers": {},
      "timeoutMs": 120000,
      "cache": { "enabled": true, "mode": "implicit" },
      "models": ["gpt-5"],
      "modelSettings": {
        "gpt-5": {
          "context": 400000,
          "maxOutputTokens": 32768,
          "temperature": 0.2
        }
      }
    }
  },
  "agents": {
    "default": {
      "id": "default",
      "name": "默认 Agent",
      "provider": "openai",
      "model": "gpt-5",
      "systemPrompt": "你是一个有用的 AI 助手。"
    },
    "reviewer": {
      "id": "reviewer",
      "name": "Reviewer",
      "provider": "openai",
      "model": "gpt-5",
      "systemPrompt": "只审查缺陷和风险。"
    }
  },
  "defaultAgentId": "default",
  "permissions": {
    "read_file": "allow",
    "write_file": "ask",
    "spawn_agent": "allow",
    "run_command": {
      "*": "ask",
      "git status*": "allow",
      "git diff*": "allow",
      "rm *": "deny"
    }
  },
  "modelLimits": {},
  "runTimeoutMs": 300000,
  "mcpServers": {},
  "lspServers": {},
  "skills": {
    "enabled": true,
    "directories": [],
    "disabled": []
  }
}
```

## 顶层字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `activeProvider` | string | 旧入口、标题生成和默认 Agent 迁移使用的 Provider |
| `activeModel` | string | 旧入口、标题生成和默认 Agent 迁移使用的模型 |
| `systemPrompt` | string | 默认 Agent 迁移和旧入口提示词 |
| `providers` | object | Provider 网络、协议和模型设置 |
| `agents` | object | Agent ID 到模型身份定义 |
| `defaultAgentId` | string | 新 Session 和省略 `agentId` 的 Run 默认选择 |
| `permissions` | object | 全局工具权限 |
| `modelLimits` | object | 旧版上下文限制兼容字段 |
| `runTimeoutMs` | number | 根 Run 和 Child Run 总预算，默认 `300000ms` |
| `mcpServers` | object | MCP stdio/HTTP 声明 |
| `lspServers` | object | LSP 进程和扩展名映射 |
| `skills` | object | Skill 开关、额外目录和禁用列表 |

## Agent

每项包含 `id`、`name`、`provider`、`model` 和 `systemPrompt`。加载旧配置时自动创建 `default` Agent；无效的 `defaultAgentId` 回退到 `default`。

Run 创建时读取 Agent 快照。运行中修改 Agent 定义不会切换该 Run 的 Provider、模型或提示词；下一次新 Run 生效。权限和共享能力仍按全局最新状态执行。

## Provider

| 字段 | 说明 |
|---|---|
| `protocol` | `openai-responses` 或 `openai-compatible` |
| `apiKey` / `baseURL` / `headers` | 认证和网络位置 |
| `timeoutMs` | 单次请求与响应流超时，默认 `120000ms` |
| `models` | 设置页可选模型目录 |
| `modelSettings` | 按模型配置 `context`、`maxOutputTokens`、`temperature` |
| `cache.enabled` | 仅 Responses 协议启用 prompt cache key |
| `cache.mode` | Responses prompt cache 模式，默认 `implicit` |

Responses 调用始终设置 `store: false`。启用缓存时使用 `sessionID:runID` 作为稳定 cache key。上下文限制优先读取 `modelSettings[model].context`，再读旧 `modelLimits`，最终回退 `128000`。

## MCP

stdio 示例：

```json
{
  "mcpServers": {
    "local": {
      "transport": "stdio",
      "command": "bun",
      "args": ["run", "mcp-server.js"],
      "env": {}
    }
  }
}
```

HTTP 示例：

```json
{
  "mcpServers": {
    "remote": {
      "transport": "http",
      "url": "https://example.test/mcp",
      "headers": { "Authorization": "Bearer token" }
    }
  }
}
```

## LSP

```json
{
  "lspServers": {
    "typescript": {
      "command": "typescript-language-server",
      "args": ["--stdio"],
      "extensions": [".ts", ".tsx"],
      "env": {}
    }
  }
}
```

LSP 进程使用 `AGENT_WORKSPACE` 指向的共享工作区。

## 更新语义

`PUT /config` 的普通字段深度合并。以下集合在请求中出现时按完整集合替换，以支持删除：

- `providers`
- `agents`
- `mcpServers`
- `lspServers`
- `skills`

Agent 设置页可提交完整 `agents` 和 `defaultAgentId`。保存配置后 Agent 目录立即重载。

`GET /config` 会脱敏 Provider 和 MCP 的密钥、认证 Header、敏感环境变量。把 `[REDACTED]` 原样提交回同名记录时，Server 恢复已保存值。

配置保存不会自动重建 MCP/LSP/Skills；能力设置流程保存后应调用 `POST /capability/reload`。
