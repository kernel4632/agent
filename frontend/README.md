# la Frontend

基于 Figma `agent` 设计实现的 Vue 3 + Vite 前端。保留深色侧栏、蓝黑聊天区、柔和背景和紧凑设置的方向，补充响应式布局、浅色主题及键盘操作。

**仅修改前端。`server/` 没有改动。**

## 界面与样式

主界面以聊天为中心：左侧管理会话，右侧显示消息，底部共用一个输入组件。新对话在首次发送时创建，模型选择按供应商与模型 ID 一起保存。设置通过原生 `dialog` 显示，关闭时保存；保存失败时保留编辑内容和面板。打开设置不切换聊天视图。

- `src/styles/tokens.scss`：深浅主题颜色、侧栏和聊天区尺寸变量，微调视觉优先从这里开始。
- `src/styles/base.scss`：页面重置、按钮、输入框、头像、开关和对话框等通用控件。
- 各 Vue 文件的 `style scoped lang="scss"`：组件布局、状态及移动端断点。
- 设置表单使用原生 Vue 控件，M3E 仅保留应用主题容器；不使用 Tailwind。

设计依据为公开 Figma 预览图中可确认的页面组成。画布访问返回 403，因此未取得完整节点尺寸和原始背景、头像素材；当前使用纯深蓝聊天背景及本地图标头像。

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
配置保存保留未编辑的提供商参数、提示词字段、权限与 MCP 配置。仅修改外观时只写浏览器 localStorage，不发送后端配置写请求。API Key 只保存在表单内存和后端配置中，不写入浏览器持久存储。

## 明确的能力边界
- 后端只有只读的工作区接口（读取和 git 状态）：没有新建、重命名、删除工作区的能力，相关入口禁用。
- 后端没有会话模型更新接口：在首页选择模型，再新建会话。已有会话内不提供虚假的模型切换。
- 工具管理、MCP 管理、数据管理没有完整接口：设置中标注待支持并禁用；工具审批使用现有接口。
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
