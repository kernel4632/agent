# la Frontend

Vue 3 + Vite 聊天前端。会话从左侧抽屉打开，新对话在首次发送时创建。设置修改自动保存；失败时保留编辑内容和面板。

## 界面与样式

- `src/styles/tokens.scss`：深浅主题颜色、侧栏和聊天区尺寸变量，微调视觉优先从这里开始。
- `src/styles/base.scss`：页面重置、全局焦点与减少动画规则。
- `src/styles/` 镜像组件目录：例如 `src/ui/Button.vue` 对应 `src/styles/ui/Button.scss`。每个 Vue 文件通过 `<style src>` 引入唯一的同名样式文件，不内嵌样式正文。
- `src/ui/` 是项目自有控件，由 Vue 和原生 HTML 实现；使用处直接导入所需的 `.vue` 文件。按钮、输入、弹层和选择控件不依赖第三方 UI 组件库。
- `src/commands/appearance.js` 使用 Material Color Utilities 的纯色彩算法生成颜色。Hugeicons 只提供图标，Markdown 相关依赖只负责内容解析和高亮。

具体控件约定见 [UI 组件说明](src/ui/README.md)。所有模型使用通用图标，不保存品牌 SVG。

## 从哪里修改

功能主体平铺在 `commands/`。页面在 `views/`，可见区域在 `components/`，基础控件在 `ui/`。组件按独立修改的理由和视觉整体划分，同类区域每组 3～5 个文件。

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
| 模型选择面板 | `src/components/composer/ModelPicker.vue`，输入区只控制开关和选择动作 |
| 设置导航和各编辑面板 | `src/views/SettingsView.vue` 中的装配表，及对应的设置组件 |

导航可以调用会话和设置；这些功能不反向调用导航。业务状态集中在 `store.js`，公共默认值在 `defaults.js`。`commands/` 不导入 Vue 组件，`ui/` 不调用业务功能；这些约束和零循环由 `tests/architecture.test.js` 检查。

工具结果统一由 `src/components/activity/ToolResult.vue` 显示参数与返回文本/JSON，保留状态和工具声明的动作。新增工具不需要新增前端组件，也没有按工具类型分发的注册表。

`components/` 按可见区域归类，样式在 `styles/components/` 中保持同样目录：

| 分组 | 内容 | Vue 文件数 |
| --- | --- | --- |
| `navigation/` | 侧栏、会话列表、顶部栏、命令面板 | 4 |
| `composer/` | 输入区、模型、智能体、思考强度选择 | 4 |
| `conversation/` | 时间线、助手回复、思考、消息操作、回退确认 | 5 |
| `activity/` | 工具调用、通用结果、任务清单、用量统计 | 4 |
| `feedback/` | 短提示、连接错误、请求状态、压缩提示 | 4 |
| `preferences/` | 外观、提示词、上下文、高级设置 | 4 |
| `providers/` | 供应商列表与编辑、供应商模型、模型设置 | 4 |
| `capabilities/` | 智能体、工具权限、MCP 列表与编辑 | 4 |

`views/` 和 `ui/` 只放组件，没有独立 JS。功能操作属于 `commands/`；页面装配留在页面，通用网络和浏览器能力放 `utils/`。`commands/` 不导入 Vue 组件，也不承担控件的转出表。

## 开发

```powershell
cd frontend
$env:AGENT_SERVER_URL = 'http://127.0.0.1:3000'
bun install
bun run dev
```

前端默认监听 `127.0.0.1:5173`，Vite 将 `/api` 转发至 `AGENT_SERVER_URL`，默认 `http://127.0.0.1:3000`。依赖使用 Bun 安装，后端 Agent 循环来自已发布的 `@kernel4632/agent-core` 包。

## 接口与数据

接口和事件定义统一看 [服务端说明](../server/README.md) 与 [OpenAPI](../server/openapi.json)，实际请求在 [`src/utils/api.js`](src/utils/api.js)。前端不再保存另一份接口文档。

- 会话历史以服务端为准。实时连接按 SSE 帧解析，重连时刷新历史。
- 配置保存保留未编辑字段；仅改外观时只写浏览器 localStorage。
- API Key 只保存在表单内存和后端配置中，不写入浏览器持久存储。
- 附件只支持文本和代码，每个不超过 1 MiB；正文随本轮消息发送。
- 输入 `/` 选择后端返回的自定义命令。数据管理尚无完整接口，入口保持禁用。

## 验证

```powershell
cd frontend
bun run test
$env:PLAYWRIGHT_CHANNEL = 'chrome'
bun run test:ui
bun run build
```

浏览器测试使用现有 Chrome，不需下载新浏览器。其他环境可安装 Playwright Chromium 后不设置 `PLAYWRIGHT_CHANNEL`。

协议测试覆盖 UTF-8/CRLF 分块、SSE 和 HTTP 契约。浏览器测试用模拟接口检查桌面和手机流程；真实模型对话需要填写供应商地址、密钥和模型 ID。测试截图与日志统一写入根目录的 `tmp/`。

生产构建在 `dist/`。`vite preview` 已配置同源 API 代理；正式静态部署需自行将 `/api/*` 转发至原始后端并移除 `/api` 前缀，SSE 不应缓冲。模型发现使用已有 Vite `/openai-proxy/models` 开发代理；静态部署无此代理时可手动添加模型 ID。
