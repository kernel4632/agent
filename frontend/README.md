# la Frontend

Vue 3 + Vite 聊天前端。会话从左侧抽屉打开，新对话在首次发送时创建。设置修改自动保存；失败时保留编辑内容和面板。

页面采用叠层导航：聊天页常驻，设置首页、设置分组和编辑详情各有独立页头与滚动区。进入时新页面从右侧覆盖，返回时上层向右滑出；下面页面保留搜索、输入和滚动位置。只有最上层接收操作，退出动画完成后才释放设置草稿。

## 界面与样式

- `src/styles/tokens.scss`：深浅主题颜色、侧栏和聊天区尺寸变量，微调视觉优先从这里开始。
- `src/styles/base.scss`：页面重置、全局焦点与减少动画规则。
- `src/styles/` 镜像组件目录：例如 `src/ui/Button.vue` 对应 `src/styles/ui/Button.scss`。每个 Vue 文件通过 `<style src>` 引入唯一的同名样式文件，不内嵌样式正文。
- `src/ui/` 是项目自有控件，由 Vue 和原生 HTML 实现；使用处直接导入所需的 `.vue` 文件。按钮、输入、弹层和选择控件不依赖第三方 UI 组件库。
- `src/utils/appearance.js` 使用 Material Color Utilities 的纯色彩算法生成颜色。Hugeicons 只提供图标，Markdown 相关依赖只负责内容解析和高亮。

具体控件约定见 [UI 组件说明](src/ui/README.md)。所有模型使用通用图标，不保存品牌 SVG。

供应商管理参考 [RikkaHub 的供应商页面](https://github.com/rikkahub/rikkahub/blob/master/app/src/main/java/me/rerere/rikkahub/ui/pages/setting/SettingProviderDetailPage.kt)：添加前先选接口类型，详情分为配置、模型和高级设置。连接字段使用分段表单，底部操作栏与滚动内容分开；模型在底部面板中添加或编辑，可用模型支持搜索与批量选择。配置自动保存，界面不展示自动保存说明或手动保存配置按钮；模型编辑确认后才写入草稿。

聊天输入框旁挨着「模型与推理」还有一个工具自动批准入口：点开是一层小窗，每个工具本身就是一个可点的开关，两列排开，点一下在「自动执行」和「先问我」之间切换。它放在这里而不是设置里，因为要不要拦是发消息时就在想的事。用量、轮次与上下文占用显示在输入框下方，点击状态栏查看会话统计。

## 从哪里修改

功能主体平铺在 `features/`，指令编排在 `commands/`。页面在 `views/`，可见区域在 `components/`，基础控件在 `ui/`。组件按独立修改的理由和视觉整体划分，同类区域每组 2～5 个文件。

| 要改的内容 | 入口 |
| --- | --- |
| 会话列表、新建、改名、删除、选择模型 | `src/features/session.js` |
| 发消息、停止、继续、工具审批、实时连接 | `src/commands/chat.js` |
| 历史消息、轮次、回退、撤销、分支 | `src/features/session.js` |
| 配置读取、草稿、自动保存 | `src/features/settings.js` |
| 供应商参数、发现模型、测试连接 | `src/features/settings.js` |
| 工具结果说明、任务状态 | `src/utils/tool.js` |
| 统计 | `src/features/stats.js` |
| 附件、外观、用量投影 | `src/utils/attachment.js`、`appearance.js`、`usage.js` |
| 切换页面、离页保存 | `src/commands/navigation.js` |
| 提示 | `src/utils/notice.js` |
| 网络契约 | `src/utils/api.js`；SSE 帧解析在 `src/utils/sse.js` |
| 新会话和已有会话的页面排布 | `src/views/ChatView.vue`，两种状态共享输入接线 |
| 模型与推理入口 | `src/components/composer/ComposerMenu.vue`，一个按钮打开一层小窗，悬停展开二级窗 |
| 设置导航和各编辑面板 | `src/views/SettingsView.vue` 中的装配表，及对应的设置组件 |

导航是编排层，可以调用会话和设置；这些主体不反向调用导航。业务状态集中在 `store.js`，公共默认值在 `defaults.js`。`features/` 只依赖 `utils/`、`store.js` 和 `defaults.js`，不能依赖 `commands/` 或另一个 feature；`commands/` 只依赖 `features/`、`utils/`、`store.js` 和 `defaults.js`，不再互相导入。`ui/` 不调用业务功能；这些约束和零循环由 `tests/architecture.test.js` 检查。

工具结果统一由 `src/components/activity/ToolResult.vue` 显示参数与返回文本/JSON，保留状态和工具声明的动作。新增工具不需要新增前端组件，也没有按工具类型分发的注册表。

`components/` 按可见区域归类，样式在 `styles/components/` 中保持同样目录：

| 分组 | 内容 | Vue 文件数 |
| --- | --- | --- |
| `navigation/` | 侧栏、会话列表、顶部栏、命令面板 | 4 |
| `composer/` | 输入区、模型、思考强度选择 | 3 |
| `conversation/` | 时间线、助手回复、思考、消息操作、回退确认 | 5 |
| `activity/` | 工具调用、通用结果、任务清单、用量统计 | 4 |
| `feedback/` | 短提示、连接错误、请求状态、压缩提示 | 4 |
| `preferences/` | 外观、提示词、上下文 | 3 |
| `providers/` | 供应商列表与编辑、供应商模型、模型设置 | 4 |
| `capabilities/` | 技能管理、MCP 列表与编辑 | 4 |

`views/` 和 `ui/` 只放组件，没有独立 JS。功能主体属于 `features/`，指令编排属于 `commands/`；页面装配留在页面，通用网络和浏览器能力放 `utils/`。`commands/` 不导入 Vue 组件，也不承担控件的转出表。

## 开发

```powershell
cd frontend
$env:AGENT_SERVER_URL = 'http://127.0.0.1:3000'
bun install
bun run dev
```

前端默认监听 `127.0.0.1:5173`，Vite 将 `/api` 转发至 `AGENT_SERVER_URL`，默认 `http://127.0.0.1:3000`。依赖使用 Bun 安装，后端 Agent 循环来自已发布的 `@kernel4632/agent-core` 包。

## 接口与数据

接口和 SSE 事件统一看 [服务端说明](../server/README.md)，实际请求在 [`src/utils/api.js`](src/utils/api.js)。前端不保存另一份接口文档；测试直接解析 `server/server.js` 核对路径。

- 会话历史以服务端为准。实时连接按 SSE 帧解析，重连时刷新历史。
- 配置保存保留未编辑字段；仅改外观时只写浏览器 localStorage。
- API Key 只保存在表单内存和后端配置中，不写入浏览器持久存储。
- 附件只支持文本和代码，每个不超过 1 MiB；正文随本轮消息发送。
- 模型对象保留名称、上下文窗口和能力；全局按任务选择模型，压缩阈值使用 `compact.threshold`，压缩后保留多少原文使用 `contextKeep`。会话设置只保存思考强度。
- MCP 和技能页打开时读取本机识别结果（`POST /admin` 的 `mcp.list` / `skill.list`）；导入 MCP、启停技能和外部目录也走同一个管理总线，不会修改其他软件的配置。
- 会话直接来自 `/session/list`，每条会话有自己的 `cwd`。前端不再调用工作区、智能体列表和斜杠命令接口，也不显示后端已移除的设置。

## 验证

```powershell
cd frontend
bun run test
$env:PLAYWRIGHT_CHANNEL = 'chrome'
bun run test:ui
bun run test:live
bun run build
```

浏览器测试使用现有 Chrome，不需下载新浏览器。其他环境可安装 Playwright Chromium 后不设置 `PLAYWRIGHT_CHANNEL`。

协议测试检查每个前端请求都存在于 `server/server.js` 注册的路由里。`test:ui` 使用受同一份路由约束的模拟响应检查交互；`test:live` 启动真实后端和前端，检查配置保存、连接测试、发送、思考强度及刷新后的历史。联调模型由本机固定回复服务提供，不使用用户密钥；测试数据、截图与日志都在根目录 `tmp/`。

生产构建在 `dist/`。`vite preview` 已配置同源 API 代理；正式静态部署需自行将 `/api/*` 转发至原始后端并移除 `/api` 前缀，SSE 不应缓冲。模型发现使用已有 Vite `/openai-proxy/models` 开发代理；静态部署无此代理时可手动添加模型 ID。
