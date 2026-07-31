# Agent

AI Agent 桌面/CLI 软件。对话驱动，工具自主调用，支持长时间运行任务。

## 特性

- 对话驱动的 ReAct 循环，无步数上限
- 工具粒度存档点，细颗粒度回滚
- 指数退避无限重试
- 可视化供应商配置（多供应商、多模型切换即时生效）
- 自定义系统提示词
- reasoning 思考折叠
- 自动扫描加载工具，用户可用 JS 编写自定义工具
- MCP 服务管理（stdio 与 Streamable HTTP）
- LSP 代码诊断、定义、引用与悬停查询
- Agent Skills 渐进披露与项目级技能发现
- 权限系统（allow / ask / deny + 通配符匹配）

## 技术栈

| 层           | 技术                                 |
| ------------ | ------------------------------------ |
| 桌面         | Go + Wails                           |
| CLI          | Go + BubbleTea                       |
| 前端         | Vue 3 + JavaScript                   |
| Agent Server | Bun + Elysia + Vercel AI SDK         |
| 分发         | bun compile 嵌入 Go 二进制，开箱即用 |

## 运行模式

三种模式共享同一个 Agent Server 进程：

- **桌面模式** — Wails 窗口
- **CLI 模式** — 终端 TUI
- **开发模式** — 浏览器 + 独立 Agent Server

## 外部能力

桌面端和开发模式可从顶部扳手图标查看 MCP、LSP 与 Skills 运行状态、立即重载或跳转到完整设置。服务增删、连接参数和开关分别位于 `设置 → MCP`、`设置 → LSP`、`设置 → 技能`；保存配置后，Agent Server 会关闭旧连接、重新发现服务与技能，并将可用工具加入统一注册表。这些工具沿用现有权限、审批、会话历史和工具调用界面。

配置保存在 `<data-directory>/config.json`。默认数据目录为 `%USERPROFILE%/.agent`，可通过 `AGENT_DATA_DIR` 修改：

```json
{
  "mcpServers": {
    "local-tools": {
      "enabled": true,
      "transport": "stdio",
      "command": "node",
      "args": ["C:/tools/mcp-server.js"],
      "cwd": "C:/tools",
      "env": {}
    },
    "remote-tools": {
      "enabled": true,
      "transport": "http",
      "url": "https://example.test/mcp",
      "headers": { "Authorization": "Bearer token" }
    }
  },
  "lspServers": {
    "typescript": {
      "enabled": true,
      "command": "typescript-language-server",
      "args": ["--stdio"],
      "root": "C:/workspace/project",
      "languageId": "typescript",
      "extensions": ["ts", "tsx"],
      "env": {}
    }
  },
  "skills": {
    "enabled": true,
    "directories": ["C:/shared/skills"],
    "disabled": []
  }
}
```

Skills 默认扫描 `<data-directory>/skills` 和 `<workspace>/.agent/skills`。每个 Skill 使用带 YAML frontmatter 的 `SKILL.md`；启动时只加载名称和描述，模型调用 `load_skill` 后才读取正文。

运行态接口：

- `GET /capability/list` 返回工具、MCP、LSP、Skills 及连接错误。
- `POST /capability/reload` 重新连接 MCP/LSP 并重新扫描 Skills。
