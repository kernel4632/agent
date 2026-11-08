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
agent config test
agent config test PROVIDER MODEL
agent mcp list
agent mcp toggle NAME on
agent mcp test NAME
agent skills list
agent skills toggle NAME off
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
agent sessions fork SESSION_ID [MESSAGE_ID]
agent sessions rollback SESSION_ID MESSAGE_ID
agent sessions rollback-tool SESSION_ID CALL_ID
agent sessions redo SESSION_ID
agent sessions title SESSION_ID
agent sessions compact SESSION_ID
agent sessions stop SESSION_ID
agent sessions remove SESSION_ID
```

新会话默认使用调用 CLI 的当前目录，以及服务端配置的默认模型。`--cwd` 是**服务端机器上的目录**；远程连接请明确指定远端路径。`--provider`、`--model`、`--reasoning` 也可配合已有会话使用。思考强度：`off / auto / low / medium / high / xhigh / max`。

`ask` 在管道和重定向里仍只把最终回复写入 stdout，会话 ID 和诊断写入 stderr，适合脚本。交互终端会边生成边写出正文，工具进度写到 stderr，结束时补上还没出现过的正式回复。`--json` 切换为逐行 JSON 事件，最后一行 `type=result` 包含持久化会话。断线重连会输出 `type=snapshot`，消费者应以快照替换旧内容；事件 ID 会因后端落盘重置，不能用它去重。`health`、`tools`、`changes` 和设置类命令默认输出可读文本；`--json` 输出单份 JSON。MCP 的 JSON 不包含环境变量和请求头。`rollback`、`rollback-tool`、`redo` 默认连文件一起恢复，`--keep-files` 只动对话。`skills` 和 `mcp list` 的 `--cwd` 是服务端上的目录，省略时 `skills` 用本机当前目录。

## 交互界面

`agent chat` 打开全屏界面。输入行是一个 `>`，空着时只有一行，多行会向上长，对话区跟着缩短，输入始终留在屏幕底部。滚轮、PgUp / PgDn 滚动记录；输入只有一行且没有待选选项时，↑↓ 也滚动。输入 `/` 会在输入行上方列出命令和说明。命令名或中文说明都能筛到，例如 `/用量`。方向键选择，Tab 补全，Enter 执行不需要参数的命令。回复按 Markdown 显示，你的消息靠左边线标出。工具跑的时候展开，结果一出来就收成一行，点击该行或 Enter 再展开；复制会带上命令和结果。思考默认收起。助手提问时，问题固定在输入框上方。写成 `1)` `2)` `3)` 的选项会拆成列表：方向键移动，数字键直接选，Enter 确认；选「其他」或自己打字则发送你写的内容。命令需要确认时，完整命令（含多行）也固定在输入框上方，用 y / a / n 决定。顶栏左边是标题和模型，右边是缩短后的当前目录（家目录显示为 `~`）。运行时，输入行上方写当前步骤和已用秒数：正在思考、正在回复，或正在执行的工具。底部一行左边是上下文（带一条用量条）、token 和速度，点击这块或按 Ctrl+U 打开统计：上下文、缓存命中、未缓存输入、构成和每个模型的首字时间、速度；右边只留当前用得上的快捷键。用量不写进对话记录。

| 操作 | 按键 |
| --- | --- |
| 发送消息 | Enter |
| 命令补全 | 输入 `/`，命令名或中文说明筛选，方向键选择，Tab 补全，Enter 执行 |
| 换行 | Alt+Enter / Ctrl+J（支持的终端也可 Shift+Enter） |
| 在输入和消息之间切换 | Tab |
| 移动、展开、复制、回退、分支 | 消息聚焦后 j/k、Enter、c、x、f |
| 只恢复这一次工具改过的文件 | 消息聚焦后 r |
| 撤销回退 | 消息聚焦后 u，或 `/redo` |
| 滚动历史 | 滚轮、PgUp / PgDn；输入只有一行且没有选项时也可以用 ↑↓ |
| 回答列出的选项 | ↑↓ 移动，数字键直接选，Enter 确认；也可以直接输入 |
| 展开/收起全部思考，流式时同样生效 | Ctrl+R |
| 会话、模型、目录、改动、任务 | Ctrl+P / Ctrl+M / Ctrl+W / Ctrl+G / Ctrl+T |
| 展开或收起工具、思考 | 点击该行，或聚焦后 Enter |
| 复制这一条的内容和结果 | 聚焦后 c，或 Ctrl+Y |
| 用量、速度、token 统计 | Ctrl+U，或 `/usage`，或点击底部用量 |
| 停止当前任务，保存半段回复 | Esc / Ctrl+C |
| 停止并退出 | Ctrl+Q |
| 空闲时退出 | Ctrl+C 或 `/quit` |
| 审批：允许一次 / 始终允许 / 拒绝 | y / a / n，确认卡固定在输入框上方 |

`/help` 打开命令和按键说明，不写进对话，Esc 关闭。`/sessions` 打开可搜索的会话列表，`/open ID` 切换，`/new [标题]` 新建。`/model`、`/reasoning`、`/cwd` 不带参数时打开选择器，带参数时直接修改。`/changes` 看文件改动，`/rollback` 回退选中消息并询问是否恢复文件，`/fork` 从选中消息分支，`/copy` 复制，`/title` 重新生成标题，`/todos` 打开任务清单，`/usage` 打开用量统计。`/resume` 继续助手，`/refresh` 重新读取历史，`/rename 标题` 改标题。路径和标题包含空格时直接输入整段，不加引号。

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

完整覆盖范围、真实 GPT 开发结果与修复记录见 [验收报告](ACCEPTANCE.md)。

`sessions compact` 会等待模型完成总结，最长 10 分钟；Ctrl+C 可取消本地等待。其他普通 HTTP 操作仍使用较短超时，避免不可达服务长期挂起。

```powershell
cd cli
go test ./...
go build -o ../tmp/cli-test/agent.exe ./cmd/agent
bun test tests/integration.test.js --timeout 30000
```

集成测试启动真实后端和 CLI 子进程，仅用本地 HTTP 服务代替外部模型。数据写入仓库 `tmp/cli-integration-*` 并清理，不使用真实用户目录或 API 密钥。Linux/macOS 构建时省略 `.exe`，或通过 `AGENT_CLI_BIN` 指定测试二进制。

当前后端同一会话只保留一个 SSE 连接。在 CLI 使用某条会话时，请关闭网页中该会话的实时页面，避免两个客户端互相断开连接。
