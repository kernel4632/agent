# la Frontend

基于 Figma `agent` 设计实现的 Vue 3 + Vite 前端。主界面以聊天为中心：会话从左侧抽屉打开，右侧显示消息，底部共用一个输入组件。新对话在首次发送时创建，模型选择按供应商与模型 ID 一起保存。设置是全屏视图，关闭时保存；保存失败时保留编辑内容和面板。

## 界面与样式

- `src/styles/tokens.scss`：深浅主题颜色、侧栏和聊天区尺寸变量，微调视觉优先从这里开始。
- `src/styles/base.scss`：页面重置、全局焦点与减少动画规则。
- `src/styles/` 镜像组件目录：例如 `src/ui/Button.vue` 对应 `src/styles/ui/Button.scss`。每个 Vue 文件通过 `<style src>` 引入唯一的同名样式文件，不内嵌样式正文。
- `src/ui/` 是项目自有控件，由 Vue 和原生 HTML 实现；页面统一从 `src/ui/index.js` 导入。按钮、输入、弹层和选择控件不依赖第三方 UI 组件库。
- `src/commands/appearance.js` 使用 Material Color Utilities 的纯色彩算法生成颜色。Hugeicons 只提供图标，Markdown 相关依赖只负责内容解析和高亮。

当前外观延续迁移前的圆角表面、深浅主题和交互节奏。具体控件约定见 [UI 组件说明](src/ui/README.md)。

## 从哪里修改

功能主体平铺在 `commands/`。页面在 `views/`，可见区域在 `components/`，基础控件在 `ui/`。组件按独立修改的理由和视觉整体划分；文件数量与行数不作为配额。

| 要改的内容 | 入口 |
| --- | --- |
| 会话列表、新建、改名、删除、选择模型 | `src/commands/session.js` |
| 发消息、停止、继续、工具审批、实时连接 | `src/commands/chat.js` |
| 历史消息、轮次、回退、撤销、分支 | `src/commands/history.js` |
| 配置读取、草稿、自动保存 | `src/commands/settings.js` |
| 供应商参数、发现模型、测试连接 | `src/commands/provider.js` |
| 工具结果说明、任务状态 | `src/commands/tool.js` |
| 统计、附件、外观 | `src/commands/stats.js`、`attachment.js`、`appearance.js` |
| 切换页面、离页保存、提示 | `src/commands/navigation.js`、`notice.js` |
| 网络契约 | `src/utils/api.js`；SSE 帧解析在 `src/utils/sse.js` |
| 新会话和已有会话的页面排布 | `src/views/ChatView.vue`，两种状态共享输入接线 |
| 模型选择面板 | `src/components/ModelPicker.vue`，输入区只控制开关和选择动作 |
| 设置导航和各编辑面板 | `src/views/SettingsView.vue`、`src/views/pages.js`、`src/components/*Settings.vue` |

导航可以调用会话和设置；这些功能不反向调用导航。业务状态集中在 `store.js`，公共默认值在 `defaults.js`。`commands/` 不导入 Vue 组件，`ui/` 不调用业务功能；这些约束和零循环由 `tests/architecture.test.js` 检查。

工具结果视图由 `ToolResult.vue` 自动发现 `components/results/*View.vue`。默认将 `FileListView.vue` 映射为 `file-list`；需要对应多个后端类型时，在该视图的普通 `<script>` 中导出 `kinds` 数组，例如 `export const kinds = ['file-read', 'file-write']`。视图仍有自己的同名 SCSS，共同结果表面由 `styles/components/ToolResult.scss` 提供。

当前实测结构与依赖图见 [源码体量](../docs/frontend-structure.html) 和 [依赖报告](../docs/frontend-dependencies.html)。设计依据见 [目标可视化](../docs/frontend-target.html)。

## 开发

```powershell
cd frontend
$env:AGENT_SERVER_URL = 'http://127.0.0.1:3000'
bun install
bun run dev
```

前端默认监听 `127.0.0.1:5173`，Vite 将 `/api` 转发至 `AGENT_SERVER_URL`，默认 `http://127.0.0.1:3000`。依赖使用 Bun 安装，后端 Agent 循环来自已发布的 `@kernel4632/agent-core` 包。

## 已对接的接口

完整请求示例、响应字段、SSE 事件和后端限制见 [前后端接口文档](docs/API.md)。

接口以实际 `server/server.js` 为准，不采用根 README 中尚未实现的资源路径。

| 功能 | 实际接口 |
| --- | --- |
| 服务状态、工作区 | `GET /health`、`GET /workspace/read` |
| 配置读取、整体保存、连接测试 | `GET /config/read`、`PATCH /config/set`、`POST /config/test` |
| 会话列表、新建、读取、重命名、删除 | `GET /session/list`、`/session/create`、`/session/read/:sessionId`、`/session/rename/:sessionId`、`/session/remove/:sessionId` |
| 任务改过的文件 | `GET /session/changes/:sessionId` |
| 回退预览、回退、撤销回退 | `POST /session/rollback/preview/:sessionId`、`POST /session/rollback/:sessionId`、`POST /session/redo/:sessionId` |
| 发送、停止 | `POST /agent/send/:sessionId`、`POST /agent/stop/:sessionId` |
| 工具审批 | `POST /agent/decide/:sessionId` |
| 事件流 | `GET /sse/connect/:sessionId` |

发送字段为 `{ input }`，审批字段为 `{ toolCallId, decision }`，历史读取字段为 `history`。回退提交 `{ messageId, files }`：`files` 默认 `true`（对话和文件一起退），传 `false` 只退对话；还能撤销几层看读取结果里的 `undoable`。SSE 按标准事件帧读取，不按 NDJSON 解析；现有后端会在保存后重置事件 ID，因此不发送 `Last-Event-ID`，重连时先读取历史，再重放当前轮次。
配置保存保留未编辑的提供商参数、提示词字段、权限、MCP、项目规则、自定义模式、写后诊断和快照配置。仅修改外观时只写浏览器 localStorage，不发送后端配置写请求。API Key 只保存在表单内存和后端配置中，不写入浏览器持久存储。

## 明确的能力边界
- 后端只有只读的工作区接口（读取和 git 状态）：没有新建、重命名、删除工作区的能力，相关入口禁用。
- 会话模型可以在对话顶部切换；任务运行中需要先停止（后端返回 409）。
- 输入 `/` 可以调用用户自定义的斜杠命令，来源是数据目录 `commands/`、工作区 `.roo/commands/` 和 `.agent/commands/`。
- 数据管理没有完整接口：设置中标注待支持并禁用；工具权限和 MCP 服务都可以在设置里改，MCP 支持 stdio / SSE / HTTP。
- 附件只支持文本和代码，每个不超过 1 MiB；读取后作为本轮输入的一部分发送。不是服务器文件上传，不支持图片或二进制文件。
- 后端的运行错误可能被吞掉且没有终态事件：前端显示等待提示与停止操作，不伪造执行成功。
- 没有新增登录、认证或远程部署能力。原始后端配置接口包含敏感值，只在可信的本机环境使用，勿直接暴露公网。

## 验证

```powershell
cd frontend
bun run test
$env:PLAYWRIGHT_CHANNEL = 'chrome'
bun run test:ui
bun run build
```

浏览器测试使用现有 Chrome，不需下载新浏览器。其他环境可安装 Playwright Chromium 后不设置 `PLAYWRIGHT_CHANNEL`。

协议测试覆盖 UTF-8/CRLF 分块、标准 SSE、错误处理与现有 HTTP 契约。浏览器测试在桌面和移动尺寸下使用受控接口响应，验证完整交互与布局；它们不冒充真实模型调用。真实模型对话需要在设置中填写你自己的提供商地址、密钥和模型 ID。

生产构建在 `dist/`。`vite preview` 已配置同源 API 代理；正式静态部署需自行将 `/api/*` 转发至原始后端并移除 `/api` 前缀，SSE 不应缓冲。模型发现使用已有 Vite `/openai-proxy/models` 开发代理；静态部署无此代理时可手动添加模型 ID。
