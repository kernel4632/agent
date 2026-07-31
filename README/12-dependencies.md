# 依赖

## Server

以 `server/package.json` 为准：

| 依赖 | 当前用途 |
|---|---|
| `elysia` | HTTP 路由、schema 和流响应 |
| `ai` | `streamText`、`generateText`、tool 和 JSON Schema 适配 |
| `@ai-sdk/openai` | OpenAI Responses 协议 |
| `@ai-sdk/openai-compatible` | OpenAI-compatible 协议 |
| `@modelcontextprotocol/sdk` | MCP stdio/HTTP 客户端和工具发现 |
| `vscode-jsonrpc` | LSP JSON-RPC 通信 |
| `zod` | 本地工具参数 schema |
| `unstorage` | Session 文件持久化抽象 |
| `nanoid` | Session 和 Run ID |
| `defu` | 配置默认值与局部深度合并 |
| `chokidar` | 自定义工具热重载 |
| `yaml` | Skill frontmatter/定义解析 |
| `consola` | 日志依赖，当前核心路径使用较少 |
| `tiktoken` | 已安装但当前上下文估算尚未使用 |

Server 开发依赖 `playwright`，用于真实浏览器/E2E 场景。

## Frontend

以 `frontend/package.json` 为准：

| 依赖 | 当前用途 |
|---|---|
| `vue` | 响应式工作台和组件 |
| `mdui` / `@mdui/icons` | Material UI 组件与图标 |
| `marked` | Markdown 解析 |
| `marked-highlight` / `highlight.js` | 代码块高亮 |
| `marked-katex-extension` / `katex` | 数学公式 |
| `mermaid` | 图表渲染 |
| `dompurify` | 清理生成 HTML |

开发依赖：

| 依赖 | 用途 |
|---|---|
| `vite` | 开发服务器和构建 |
| `@vitejs/plugin-vue` | Vue SFC 编译 |
| `sass` | SCSS 样式编译 |

## 选择边界

- 不安装每个 AI SDK Provider；当前只支持两个显式协议适配器。
- 前端不依赖 `@ai-sdk/vue`，POST SSE 由本地解析器消费。
- Context 裁剪目前不依赖 tokenizer，即使 `tiktoken` 已在依赖中。
- Go/Wails/BubbleTea 是未来规划，当前没有 Go module 或对应依赖锁文件。
