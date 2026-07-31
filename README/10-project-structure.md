# 项目结构

## 当前仓库

```text
agent/
|-- server/                         Bun/Elysia Agent Server
|   |-- server.js                   应用入口和路由组合
|   |-- runtime.js                  资源启动、回滚和关闭
|   |-- schemas.js                  Elysia 请求模型
|   |-- responses.js                Command 到 HTTP/SSE 的转换
|   |-- store.js                    服务端唯一进程状态根
|   |-- routes/
|   |   |-- agent.js                Agent API
|   |   |-- chat.js                 Chat、停止和审批 API
|   |   |-- session.js              Session、任务和回退 API
|   |   |-- run.js                  Run 查询和取消 API
|   |   |-- tool.js                 Tool API
|   |   |-- capability.js           MCP/LSP/Skills API
|   |   `-- config.js               Config API
|   |-- commands/
|   |   |-- agent.js                Agent 目录和快照
|   |   |-- approval.js             Run 级审批
|   |   |-- chat.js                 根/子 Agent 循环和 SSE
|   |   |-- run.js                  Run 树和取消传播
|   |   |-- session.js              Session 持久化和回退
|   |   |-- config.js               配置、Provider 和模型
|   |   |-- tool.js                 工具扫描和 watcher
|   |   |-- mcp.js                  MCP 连接与动态工具
|   |   |-- lsp.js                  LSP 进程与代码工具
|   |   `-- skill.js                Skill 扫描和披露
|   |-- tools/built-in/
|   |   |-- agent.js                task_done/task_list_update/spawn_agent
|   |   |-- file.js                 文件工具
|   |   |-- shell.js                命令工具
|   |   `-- web.js                  Web 工具
|   |-- utils/
|   |   |-- retry.js                有限退避和模型轮次预算
|   |   `-- compress.js             模型消息裁剪
|   `-- test/
|       |-- server.test.js          API、审批、Run 和真实模型测试
|       |-- runtime.test.js         Runtime 故障回滚测试
|       |-- real-agent.e2e.js       独立真实 Agent E2E
|       `-- fixtures/               MCP/LSP 测试进程
|-- frontend/                       Vue/Vite 工作台
|-- README/                         架构和协议文档
`-- AGENTS.md                       项目协作约束
```

当前仓库没有 `desktop/` Go 模块。

## 前端

```text
frontend/src/
|-- main.js                         Vue 入口
|-- App.vue                         工作台根组件
|-- api.js                          全部 HTTP 调用
|-- store.js                        前端唯一响应式状态根
|-- watchers.js                     页面状态联动
|-- views/
|   |-- Chat.vue                    对话工作区
|   |-- Sessions.vue                Session 列表
|   `-- Settings.vue                设置工作区
|-- commands/
|   |-- agent.js                    Agent 目录
|   |-- chat.js                     SSE、Run、审批和回退
|   |-- session.js                  Session 资源
|   |-- config.js                   配置资源
|   |-- capability.js               外部能力
|   |-- settings.js                 设置草稿
|   |-- tabs.js                     多会话标签
|   |-- ui.js                       导航状态
|   `-- workspace.js                工作台初始化
|-- components/
|   |-- AgentProfiles.vue           Agent 创建、编辑、默认和删除
|   |-- AgentSelector.vue           Session Agent 选择
|   |-- RunTree.vue                 根/子 Run 树
|   |-- MessageList.vue             消息列表
|   |-- MessageItem.vue             消息分派
|   |-- ToolCall.vue                工具、审批和回退
|   |-- TaskPanel.vue               任务清单
|   |-- InputBox.vue                输入和停止
|   |-- ProviderConfig.vue          Provider 设置
|   |-- PermissionEditor.vue        权限设置
|   |-- CapabilitySettings.vue      MCP/LSP/Skills 设置
|   `-- MarkdownContent.vue         安全 Markdown 渲染
|-- utils/
|   |-- sse.js                      POST SSE 解析
|   `-- markdown.js                 Markdown/代码/公式/图表
`-- styles/                         主题和布局
```

前端不按领域建立多个 Store 文件。`store.js` 定义唯一状态根，`commands/` 是唯一修改入口。

## 用户数据

```text
~/.agent/
|-- config.json                     全局配置和 Agent 定义
|-- sessions/                       unstorage 文件持久化 Session
`-- tools/custom/                   用户工具
```

内置工具从 `server/tools/built-in/` 直接加载，不复制到用户目录。Run、Child Run、AbortController 和 pending approval 只在进程内。

## HOP 对应

| HOP 环节 | 当前实现 |
|---|---|
| 触发 | Vue Component 或 Elysia Route |
| 指令 | `frontend/src/commands/` 或 `server/commands/` |
| 数据 | 两端各自唯一 `store.js`，Session 另有磁盘副本 |
| 反馈 | Vue 响应式更新、JSON、SSE、文件持久化 |

发送消息的追踪路径：

```text
InputBox.vue
-> frontend commands/chat.js
-> api.js
-> server routes/chat.js
-> commands/run.js + commands/chat.js
-> commands/session.js + store.js
-> SSE
-> frontend commands/chat.js
-> frontend store.js
```

## 未来 Desktop/CLI 布局

以下是规划，不是当前文件：

```text
desktop/
|-- main.go                         宿主入口
|-- wails/                          桌面窗口和绑定
|-- tui/                            BubbleTea CLI 和 SSE 客户端
|-- process/                        Agent Server 子进程托管
|-- go.mod
`-- go.sum
```

未来宿主必须通过公开 HTTP/SSE API 工作，不直接导入 Server Commands 或复制 Store。
