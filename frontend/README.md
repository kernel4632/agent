# la Frontend

基于 Figma `agent` 设计实现的 Vue 3 + Vite 前端。保留深色侧栏、蓝黑聊天区、柔和背景和紧凑设置的方向，补充响应式布局、浅色主题及键盘操作。

**仅修改前端。`server/` 与 `core/` 没有改动。**

## 开发

```powershell
cd F:\opencodexm\la\agent\frontend
$env:AGENT_SERVER_URL = 'http://127.0.0.1:3000'
& 'D:\la-dev\tools\bun-windows-x64\bun.exe' run dev
```

通用环境可使用 `bun install`、`bun run dev`。前端默认监听 `127.0.0.1:5173`，Vite 将 `/api` 转发至 `AGENT_SERVER_URL`，默认 `http://127.0.0.1:3000`。

本机环境组织：

| 内容 | 位置 |
| --- | --- |
| 源码 | `F:\opencodexm\la\agent` |
| Bun | `D:\la-dev\tools\bun-windows-x64\bun.exe` |
| 依赖实体 | `D:\la-dev\packages\{frontend,server,core}\node_modules` |
| Bun 缓存 | `D:\la-dev\cache\bun` |
| 独立运行数据 | `D:\la-dev\data` |
| 日志、截图、测试产物 | `D:\la-dev\logs`、`D:\la-dev\artifacts` |

源码中的 `node_modules` 是指向 D 盘的 Windows junction。Node 解析要求实体目录仍命名为 `node_modules`。本机 Bun 的 `file:../core` 安装发生跨卷复制问题，已通过本地 package junction 引用原始 `core`，没有修改后端依赖声明。

`D:\la-dev\tools\start-preview.ps1` 可启动本机预览。它通过外部启动脚本导入原始后端，监听回环地址 `127.0.0.1:3000`；不修改后端源文件，也不注入新 API。

## GitHub 代理

此仓库的本地 Git 配置将 GitHub 请求代理到 `socks5h://127.0.0.1:10819`。该端口通过 `us1` SSH 隧道访问网络，保留主机密钥验证。

重新开启隧道：

```powershell
ssh -F D:\la-dev\ssh\config -N -D 127.0.0.1:10819 us1
```

SSH 凭据不在仓库内。不要将 `ssh_active_servers.txt`、私钥或浏览器配置提交到 Git。

## 已对接的接口

完整请求示例、响应字段、SSE 事件和后端限制见 [前后端接口文档](docs/API.md)。

接口以实际 `server/server.js` 为准，不采用根 README 中尚未实现的资源路径。

| 功能 | 实际接口 |
| --- | --- |
| 配置读取、整体保存 | `GET /config/read`、`PATCH /config/set` |
| 新建、读取、重命名、删除会话 | `/session/create`、`/session/read/:sessionId`、`/session/rename/:sessionId`、`/session/remove/:sessionId` |
| 发送、停止 | `POST /agent/send/:sessionId`、`POST /agent/stop/:sessionId` |
| 工具审批 | `POST /agent/decide/:sessionId` |
| 回退、撤销回退 | `POST /session/rollback/:sessionId`、`POST /session/redo/:sessionId` |
| 事件流 | `GET /sse/connect/:sessionId` |

发送字段为 `{ input }`，审批字段为 `{ callId, decision }`，历史读取字段为 `history`。SSE 按标准事件帧读取，不按 NDJSON 解析；现有后端会在保存后重置事件 ID，因此不发送 `Last-Event-ID`，重连时先读取历史，再重放当前轮次。

配置保存保留未编辑的提供商参数、提示词字段、权限与 MCP 配置。仅修改外观时只写浏览器 localStorage，不发送后端配置写请求。API Key 只保存在表单内存和后端配置中，不写入浏览器持久存储。

## 明确的能力边界

- 后端没有工作区管理接口：相关入口禁用，不创建伪工作区或目录权限。
- 后端没有全量会话列表接口：浏览器只保存自己创建或手动打开过的会话 ID 和摘要。可通过 ID 打开其他已有会话。清除浏览器存储不会删除后端内容，但会丢失本机索引。
- 后端没有会话模型更新接口：在首页选择模型，再新建会话。已有会话内不提供虚假的模型切换。
- 工具管理、MCP 管理、数据管理没有完整接口：设置中标注待支持并禁用；工具审批使用现有接口。
- 附件只支持文本和代码，每个不超过 1 MiB；读取后作为本轮输入的一部分发送。不是服务器文件上传，不支持图片或二进制文件。
- 后端的运行错误可能被吞掉且没有终态事件：前端显示等待提示与停止操作，不伪造执行成功。
- 没有新增登录、认证或远程部署能力。原始后端配置接口包含敏感值，只在可信的本机环境使用，勿直接暴露公网。

## 验证

```powershell
& 'D:\la-dev\tools\bun-windows-x64\bun.exe' run test
$env:PLAYWRIGHT_CHANNEL = 'chrome'
$env:LA_TEST_OUTPUT_DIR = 'D:\la-dev\artifacts\ui-tests'
& 'D:\la-dev\tools\bun-windows-x64\bun.exe' run test:ui
& 'D:\la-dev\tools\bun-windows-x64\bun.exe' run build
```

浏览器测试使用现有 Chrome，不需下载新浏览器。其他环境可安装 Playwright Chromium 后不设置 `PLAYWRIGHT_CHANNEL`。

协议测试覆盖 UTF-8/CRLF 分块、标准 SSE、错误处理与现有 HTTP 契约。浏览器测试在桌面和移动尺寸下使用受控接口响应，验证完整交互与布局；它们不冒充真实模型调用。真实模型对话需要在设置中填写你自己的提供商地址、密钥和模型 ID。

生产构建在 `dist/`。`vite preview` 已配置同源 API 代理；正式静态部署需自行将 `/api/*` 转发至原始后端并移除 `/api` 前缀，SSE 不应缓冲。模型发现使用已有 Vite `/openai-proxy/models` 开发代理；静态部署无此代理时可手动添加模型 ID。
