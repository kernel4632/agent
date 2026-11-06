# macOS 使用与验证

项目提供本机 Bun 后端、浏览器界面和 Go CLI。桌面应用尚未实现，没有 `.app` 或 DMG 安装包。

## 安装和启动

在终端中安装 Bun（官方安装器），然后重新打开终端：

```sh
curl -fsSL https://bun.sh/install | bash
bun --version
```

在仓库根目录安装锁定的依赖：

```sh
(cd server && bun install --frozen-lockfile)
(cd frontend && bun install --frozen-lockfile)
```

分别在两个终端启动：

```sh
cd server
bun start
```

```sh
cd frontend
bun run dev
```

打开 http://127.0.0.1:5173，在设置中配置自己的模型服务。后端默认端口为 3000，可通过 `PORT` 改变；前端代理通过 `AGENT_SERVER_URL` 指向对应后端，例如：

```sh
# 第一个终端，从仓库根目录执行
AGENT_HOME="$PWD/tmp/mac-data" PORT=3101 bun run --cwd server start
# 第二个终端，从仓库根目录执行
AGENT_SERVER_URL=http://127.0.0.1:3101 bun run --cwd frontend dev --port 5174 --strictPort
```

上述隔离启动使用 `tmp/mac-data`；日常启动的默认数据目录为 `~/.agent`。全局技能为 `~/.agents/skills`，会话项目技能为 `.agent/skills`。指定 `AGENT_HOME` 后，全局技能会改用该目录下的 `skills/`。

## CLI

安装 `cli/go.mod` 所需版本或更新的 Go。从仓库根目录构建并连接已启动的服务：

```sh
mkdir -p tmp/cli-test
(cd cli && go build -o ../tmp/cli-test/agent ./cmd/agent)
./tmp/cli-test/agent --server http://127.0.0.1:3000 health
./tmp/cli-test/agent --server http://127.0.0.1:3000
```

macOS 二进制没有 `.exe` 后缀。`go install ./cmd/agent` 也可以安装到 Go 的 bin 目录。

## 系统行为

- 命令通过 `sh -c` 执行；即使终端登录 shell 是 zsh，也应使用 POSIX shell 语法。macOS 自带 BSD 工具，参数可能与 GNU/Linux 不同。
- 命令超时、取消，以及后台进程停止/退出清理，会终止该命令独立进程组中的子进程。主动另建会话的守护程序需要按自身机制管理。
- 自动发现支持 `~/Library/Application Support/Claude/claude_desktop_config.json`、`Code/User/mcp.json`，以及 Code 的 Cline、Roo Code 扩展配置。Claude Code、Codex、Cursor 等使用各自的用户目录。
- Cmd+K / Cmd+P 打开命令面板，Cmd+, 打开设置。WebKit 下弹窗关闭会恢复按钮焦点，模型菜单支持 Tab 和方向键导航。
- 原生依赖必须在当前 Mac 上安装；请勿直接复用 Windows 或其他架构的 `node_modules`。

## 验证

所有后端与 CLI 联调均使用临时数据目录。前后端真实联调只替换外部模型服务，HTTP、SSE、配置和历史落盘均执行真实代码。

```sh
(cd server && bun test)
(cd frontend && bun run test && bun run build)
(cd cli && go test ./...)
(cd cli && go build -o ../tmp/cli-test/agent ./cmd/agent)
(cd cli && bun test tests/integration.test.js --timeout 30000)
(cd frontend && bunx playwright install chromium webkit)
(cd frontend && bun run test:ui)
(cd frontend && bun run test:live)
```

浏览器测试包含 Chromium 桌面/移动视口和 WebKit；WebKit 用于覆盖 Safari 引擎行为，不等同于对所有 Safari 版本的验证。默认真实联调使用 3001/4175 端口，界面测试使用 4174；运行前确保这些端口未被其他服务占用。

本次在 Apple Silicon 的 macOS 上执行验证；Intel Mac 尚未实机验证。测试用本机模型替身，无需真实模型凭据；真实供应商的可用性由配置和对应服务决定。子任务功能当前已下架，相关测试保留为跳过。
