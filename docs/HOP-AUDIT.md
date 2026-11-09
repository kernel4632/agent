# 接手审查

最后更新：2026-11-04。范围是 `server/`、`frontend/src/` 和 `cli/` 的当前源码。

旧版 2026-10-28 的审查针对已经删除的 `conversation/`、`agent/`、`safety/` 目录，不再保留。现行结构以本文件和各个 README 为准。

## 先读什么

1. [AGENTS.md](../AGENTS.md)：提交、版本号、验证和三处契约的硬规则。
2. [NOTES.md](../NOTES.md)：产品定位和取舍（会话为中心，不做工作区和 git 概念）。
3. [server/README.md](../server/README.md)：HTTP/SSE 契约、权限规则、数据目录。
4. [frontend/README.md](../frontend/README.md)：前端从哪里改。
5. [cli/README.md](../cli/README.md)：CLI 命令和按键。

## 现在长什么样

```text
server.js              入口：装配有状态模块、注册路由、统一错误、启动
store.js               全局数据：config 和 sessions 两个纯对象
commands/              HTTP 动作和运行编排，命令文件之间不互相 import
  chat.js              发送、继续、停止、审批；一次运行的编排
  session.js           会话 CRUD、目录、模型、设置、回退、压缩
  settings.js          配置读写、模型测试、工具目录
features/              独立业务模块，互相不 import
  agent.js             模型连接、提示词、工具表、运行实例缓存
  approval.js          工具审批（规则 + 等待用户决定）
  tool.js              扫描 tools/，装配工具表、快照入口
  history.js           会话资料、消息、回退栈
  rollback.js          消息回退（不碰文件）
  context.js           系统提示词和模型上下文信息
  compact.js           压缩（纯逻辑，历史由命令层写）
  title.js             自动标题
  config.js            配置读取、补默认值、整体替换
  mcp.js               MCP 服务连接
utils/                 fail.js、path.js、sse.js、usage.js
tools/                 一个文件一组工具，启动时自动扫描
tests/                 真实 HTTP 请求 + 临时数据目录
```

前端：

```text
src/commands/          功能主体，一个功能一个文件
src/views/             页面装配（ChatView、SettingsView）
src/components/        可见区域，按 navigation/composer/conversation/activity/feedback/preferences/providers/capabilities 分组
src/ui/                自有基础控件
src/styles/            所有样式，镜像 src/ 目录
src/utils/             网络契约 api.js、SSE 解析、Markdown、剪贴板等
```

CLI：`cmd/agent` 是入口，`internal/command` 是 cobra 命令，`internal/chat` 是运行和 SSE，`internal/tui` 是 Bubble Tea 界面，`internal/api` 是协议层。

## 一次请求怎么走

```text
HTTP/SSE → server.js → commands/* → features/* → store.js / utils/
                                      └─ features/tool.js → tools/*
```

命令层不互相 import，feature 之间也不互相 import；需要别的 feature 时由 `server.js` 在启动时注入。`tools/` 只依赖 `store.js`、`utils/` 和运行时 context。

## 验证

```powershell
cd server
bun test

cd frontend
bun run test
bun run build
bun run test:ui      # 改到界面时再跑

cd cli
go test ./...
```

2026-11-04 实测基线：后端 161 个测试通过，前端逻辑测试 38 个通过，构建通过。数字只用来对照，验收以当次输出为准。

## 改东西时先看

- 加工具：只往 `server/tools/` 放一个文件，写 `name`、`kind`、`description`、`inputSchema`、`execute`；会改文件的工具再带 `snapshot`。
- 改发送、停止、继续、回退：先看 `commands/chat.js` 的收尾顺序和 `tools/file.js` 的快照语义，再改测试。
- 改接口：`server/README.md` 和 `frontend/src/utils/api.js` 一起改；路由只在 `server/server.js` 注册一次，前端测试直接解析它核对路径。`server/tests/contract.test.js` 会盯着版本、工具类别、结束工具名单和 SSE 事件表。
- 加 feature 依赖：只改 `server.js` 的装配段，不要回到命令文件里各写一份 `Agent.bind(...)`。
- 数据目录：测试和开发都用 `AGENT_HOME` 指向临时目录，不写真实 `~/.agent`。

## 已知边界

- 桌面端还没开始。
- 同一会话只支持一个 SSE 连接；网页和 CLI 同时看一条会话会互相替换连接。
- 附件只支持文本和代码，每个不超过 1 MiB。
- 服务端没有登录鉴权，也没有单独配置 CORS；部署时让前后端同源或走反向代理，并关闭 SSE 缓冲。
- 设置里的“数据管理”页还是占位，导出和清理没有实现。
- 工具结果统一由 `ToolResult.vue` 渲染；新增工具不需要新增前端组件。
