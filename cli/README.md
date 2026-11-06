# Agent CLI

适配本仓库当前 HTTP/SSE 接口的 Go 客户端，与网页共用服务端会话、模型配置、历史和工具权限。版本在 `VERSION`，要求 Go 1.26 或更新版本。

当前适配 agent-core 0.30.4：续跑使用服务端原生 `resume()`；带 `request: "compact"` 的压缩增量不会混进回答或停止时保存的半段回复，`--json` 仍原样输出这些事件。集成测试按当前协议调用结束工具，覆盖流式正文、工具答复及压缩用量。

## 构建

在仓库根目录执行：

```powershell
cd cli
go build -o ../tmp/agent.exe ./cmd/agent
../tmp/agent.exe --help
```

Linux/macOS 把输出路径换成 `../tmp/agent`。也可以在 `cli/` 中执行 `go install ./cmd/agent`，将 `$GOBIN`（默认 `$GOPATH/bin`）加入 PATH 后使用 `agent`。

先按照 [后端说明](../server/README.md) 启动服务并配置模型。默认连接 `http://127.0.0.1:3000`，可用 `--server URL` 或环境变量 `AGENT_SERVER_URL` 指定，参数优先。

## 命令

```powershell
agent health
agent models
agent tools
agent chat
agent chat --session SESSION_ID
agent ask "解释这个项目" --cwd "F:/projects/example"
agent ask "继续补充" --session SESSION_ID
agent ask --session SESSION_ID --resume
Get-Content -Raw README.md | agent ask
agent ask "生成说明" --json
agent sessions list --search "项目"
agent sessions show SESSION_ID
agent sessions rename SESSION_ID "新标题"
agent sessions model SESSION_ID PROVIDER MODEL
agent sessions reasoning SESSION_ID high
agent sessions cwd SESSION_ID "F:/projects/another"
agent sessions changes SESSION_ID
agent sessions fork SESSION_ID
agent sessions compact SESSION_ID
agent sessions stop SESSION_ID
agent sessions remove SESSION_ID
```

新会话默认使用调用 CLI 的当前目录，以及服务端配置的默认模型。`--cwd` 是**服务端机器上的目录**；远程连接请明确指定远端路径。`--provider`、`--model`、`--reasoning` 也可配合已有会话使用。思考强度：`off / auto / low / medium / high / xhigh / max`。

`ask` 将最终回复写入 stdout，会话 ID 和诊断写入 stderr，适合脚本和重定向。`--json` 切换为逐行 JSON 事件，最后一行 `type=result` 包含持久化会话。断线重连会输出 `type=snapshot`，消费者应以快照替换旧内容；事件 ID 会因后端落盘重置，不能用它去重。普通命令的 `--json` 输出单份 JSON。

## 交互界面

`agent chat` 打开 Bubble Tea 全屏界面，显示历史、流式正文、思考、工具调用/结果及 token 用量。连接运行中的会话时会恢复待审批工具。

| 操作 | 按键 |
| --- | --- |
| 发送消息 | Enter |
| 换行 | Alt+Enter / Ctrl+J（支持的终端也可 Shift+Enter） |
| 滚动历史 | PgUp / PgDn |
| 展开/收起思考，流式时同样生效 | Ctrl+R |
| 停止当前任务，保存半段回复 | Esc / Ctrl+C |
| 停止并退出 | Ctrl+Q |
| 空闲时退出 | Ctrl+C 或 `/quit` |
| 审批：允许一次 / 始终允许 / 拒绝 | y / a / n |

输入 `/help` 查看快捷命令。`/sessions` 列出会话，`/open ID` 切换，`/new [标题]` 新建，`/model 供应商 模型`、`/reasoning high`、`/cwd 路径`、`/rename 标题` 修改当前会话。`/resume` 继续助手，`/refresh` 重新读取历史。路径和标题包含空格时直接输入整段，不加引号。

## 工具审批与停止

供应商或模型名含空格时使用引号，例如 `/model "provider with spaces" gpt-model`；单引号也支持。

`ask` 默认遇到待审批工具就返回非零退出码，显示会话 ID 和调用 ID，任务保留在服务端等待。可以显式选择 `--permission deny` 或 `--permission allow-once`，应用于本次运行遇到的审批，不写全局规则。已有全局 `deny` 仍由后端执行。

```powershell
agent sessions decide SESSION_ID CALL_ID allow-once
agent sessions decide SESSION_ID CALL_ID deny
agent sessions decide SESSION_ID CALL_ID allow-always
```

`allow-always` 会按后端语义保存全局权限规则。Ctrl+C 会请求停止，并提交当前模型已经生成的半段正文与思考。网络错误不会重发消息；重连失败时会提示任务可能仍在运行，可用 `sessions show/stop` 检查或停止。

## 验证

`sessions compact` 会等待模型完成总结，最长 10 分钟；Ctrl+C 可取消本地等待。其他普通 HTTP 操作仍使用较短超时，避免不可达服务长期挂起。

```powershell
cd cli
go test ./...
go build -o ../tmp/cli-test/agent.exe ./cmd/agent
bun test tests/integration.test.js --timeout 30000
```

集成测试启动真实后端和 CLI 子进程，仅用本地 HTTP 服务代替外部模型。数据写入仓库 `tmp/cli-integration-*` 并清理，不使用真实用户目录或 API 密钥。Linux/macOS 构建时省略 `.exe`，或通过 `AGENT_CLI_BIN` 指定测试二进制。

当前后端同一会话只保留一个 SSE 连接。在 CLI 使用某条会话时，请关闭网页中该会话的实时页面，避免两个客户端互相断开连接。
