# CLI 验收记录 · 2026-11-06

## 版本与范围

Windows x64，Bun 1.4.4，Go 1.26.4。验收版本：CLI 0.3.5（本报告发布为 0.3.6）、server 0.65.8、frontend 0.99.31、agent-core 0.30.4。

先保持原 CLI 内容不变，同步上游 112 个提交至 `6904c47`，再对验收发现的问题逐项修复。所有验证使用隔离 `AGENT_HOME`、端口、技能和 MCP 配置，不修改用户真实数据。`test-tools/` 的测试 MCP、技能及模型凭据不纳入提交。

## 最终结果

| 验证 | 结果 |
| --- | --- |
| 后端 `bun test --parallel=1` | 240 pass，0 fail，987 assertions |
| CLI `go test -count=1 ./...`、`go vet ./...`、构建 | 全部通过 |
| CLI + 真实后端联调 | 8 pass，0 fail，79 assertions |
| 前端单测、生产构建 | 57 pass，构建成功 |
| 桌面/移动端 UI | 162 pass；两项移动端滚轮用例按原配置跳过，桌面版本通过 |
| Windows 权限记忆 | 9 项通过 |
| CLI 黑盒功能、协议边界 | 10 组、7 组通过 |
| Windows 终端交互 | 7 组主流程、5 组补充流程通过 |
| 真实 GPT 终端交互 | 5 组通过 |
| GPT 生成项目的独立测试 | 34 pass，0 fail，176 assertions |
| GPT 生成项目的真实浏览器操作 | 8 项通过，无页面异常 |

初次失败、人工中断和修复前证据保留；只有修复后重新验证的结果计为通过。

## CLI 覆盖面

- help、version、四种 shell completion、health、models、tools。
- ask：参数与管道输入、中文多行、JSON、会话续问、原生 resume、模型/思考/目录参数、非法和超大输入。
- sessions：list/search/show/rename/cwd/model/reasoning/fork/compact/changes/stop/remove/decide。
- chat：全部斜杠命令、中文多行、滚动、调整尺寸、推理展开、y/a/n 审批、运行中会话重新连接。
- Esc/Ctrl+C 停止且保存已生成内容；Ctrl+Q 停止后退出；真实 Windows Ctrl+C 信号使 ask 退出码为 1。
- 权限：同会话、新会话、重启持久化、中文/空格路径、不同路径负例、全局硬拒绝与子任务审批。
- 强制 SSE 断开后恢复快照，只发送一次用户输入；地址环境变量/参数优先级、前缀/尾斜杠及错误响应。

## 真实模型开发场景

使用用户指定兼容接口的 `gpt-6-astra`，通过实际 CLI 完成需求澄清、应用实现、反馈迭代、独立审查、压缩、续问和 resume。产物为 **Focus Board 中文任务看板**：任务增删、优先级、完成/重新打开、搜索过滤、localStorage、JSON 导入导出及错误保护。项目只保留在本地测试目录。

成功执行全部 16 种内置工具，以及两种测试 MCP 工具：

`read_file`、`read_range`、`write_file`、`find_files`、`search_text`、`edit`、`execute_command`、`background`、`test`、`cwd`、`update_todo_list`、`new_task`、`skill`、`webfetch`、`attempt_completion`、`ask_followup_question`、`acceptance_requirements`、`acceptance_acceptance`。

- `background` 的 start/log/list/stop 均经实际运行验证。
- `vb-development`、`vb-review` 两项测试技能通过扫描与按需加载进入真实模型流程。
- MCP 通过真实 stdio 握手、工具发现及调用验证。
- 最终子任务复验确认审批返回父会话、读取工具成功、`conclusion` 非空且包含真实审查依据。
- 真实长上下文压缩、压缩后执行测试和原生续跑均通过。
- 浏览器验收涵盖中文任务与优先级、刷新持久化、完成/重开、空标题拒绝、搜索/过滤、非法导入保护、导出/导入往返及移动端无水平溢出。

## 修复的问题

1. 后端契约测试引用了前端已迁移文件。
2. 中文 Windows 路径的权限记忆被匹配器快路径破坏。
3. 后端退出调用了错误的后台进程 cleanup 导出。
4. CLI `/model` 不支持含空格的供应商/模型名称。
5. 旧联调夹具使用过时结束方式并复用工具调用 ID。
6. 打开/刷新会话覆盖已经收到的实时重试进度。
7. UI 验收引用旧 MCP/外观控件、未滚动至目标或使用无效 Markdown。
8. 子任务回调里的临时 Agent ID 覆盖父会话 ID，审批无法到达父 CLI。
9. 子任务结束工具的最终答案没有进入返回的 `conclusion`。
10. 长压缩同时受到 CLI 响应头超时和服务端空闲超时影响。

## 复现

```text
cd server
bun test --parallel=1

cd ../frontend
bun run test
bun run build
bun run test:ui

cd ../cli
go test -count=1 ./...
go vet ./...
go build -o ../tmp/cli-test/agent.exe ./cmd/agent
bun test tests/integration.test.js --timeout 30000
```

Linux/macOS 构建路径去掉 `.exe`。真实模型测试需要自己的接口和密钥。完整本地日志、终端录屏、MCP 调用记录与浏览器截图位于 `tmp/cli-full-20261106/`；该目录 `latest-real.txt` 指向实际开发项目与逐工具核对结果。
