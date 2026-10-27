# HOP 合规审查

按 `C:\Users\17137\.agent\skills\hop\SKILL.md` 的 12 条原则审查整个项目的服务端和前端。
审查方式是先由子智能体逐文件读代码，再在主会话里核对证据；下面只保留能落到具体文件和行号的结论。

## 结论

- 确定违规 24 项：高 6、中 12、低 6。
- 本轮已修 12 项，剩下 12 项分为“需要用户确认的结构改动”和“可以以后再做的小问题”。
- 最严重的三项已经修掉：新建会话丢失 `workspaceId`、设置页把全局 `deny` 显示成 `ask`、默认值散落在 6 个文件。

## 已修复

| 条款 | 位置 | 改法 |
| --- | --- | --- |
| 第 3、4 条 | `frontend/src/api.js` | 新建会话把 `workspaceId` 一起发给后端，多工作区时不会归错 |
| 第 3、4 条 | `server/commands/tools.js` | 权限显示改走同一个动作归一化函数；全局 `deny` 现在真的显示“禁止调用” |
| 第 2 条 | `server/commands/tools.js` | 工具类别改用 `Kind.of()`，不再直接读 `TABLE` |
| 第 3 条 | `frontend/src/commands/defaults.js`（新增） | 前端默认值收成一份：自动批准上限、压缩阈值、上下文窗口、新会话标题 |
| 第 11 条 | `server/commands/settings.js` | 删掉只导出、没有调用方的旧 `DEFAULTS` |
| 第 2、3 条 | `frontend/src/commands/config.js`、`session.js`、`session/AgentDrawer.vue` | 智能体兜底只保留一份；工具类别名只从 `AUTO_APPROVE_KINDS` 取 |
| 第 3 条 | `frontend/src/commands/continue.js` | “这条消息是否存过”只留一个 `isSavedMessage()`，继续、回退、分支共用 |
| 第 11 条 | `frontend/src/watchers.js` | 删掉没有调用方的 `watchMessages`、`watchMarkdownContent` |
| 第 3 条 | `server/tools/diagnose.js` | 诊断命令改用 `Path.config()`，不再自己拼数据目录 |
| 第 4 条 | `frontend/src/App.vue` | 新会话总是保存一次设置，入口不再比较各默认值 |
| 第 3 条 | `frontend/src/commands/tabs.js`、`workspace.js`、`app/TopBar.vue` | 新会话标题统一用 `NEW_SESSION_TITLE` |
| 第 8 条 | `server/tools/grep.js`、`shell.js`、`features/delegation.js` | 工具第二参写成可选，执行器只传 input 时不再崩溃 |

## 需要用户确认的结构改动

这些改动会动文件名、目录或跨文件数据所有权，按 HOP 第 12 条先列出来，不直接做。

1. **工具元数据仍要改中央表**（`server/utils/tool-kind.js:38`、`utils/tool-files.js:19`）。
   加一个会改文件的工具，除了新建 `tools/*.js`，还要登记类别和文件工具名单；漏登记时只会在契约测试里报出来。
   建议让每个工具文件自己声明 `kind` 和是否碰文件，启动扫描时建表。需要改所有现有工具文件。
2. **会话历史有两份可写副本**（`server/store.js:20`、`commands/session.js:144-150,238-251,344-345,494-495`）。
   `Store.sessions` 和 `agent.history` 都能写，`run()` 里的同步逻辑因此越来越长。
   建议选一个唯一写入者，另一个只读；涉及取消、回退、断线恢复，改动面大。
3. **文件名带技术角色**（`server/features/delegation.js`、`features/commands.js`、`commands/tools.js`）。
   建议改成 `subtask.js`、`slash-commands.js`、`tool-catalog.js`；会动 import 和测试路径。

## 还没修的具体项

| 优先级 | 位置 | 问题 | 最小修法 |
| --- | --- | --- | --- |
| 高 | `server/commands/session.js:579-719` | `run()` 141 行，`then` 和 `catch` 各抄一份收尾逻辑 | 同文件加一个本地 `finish()`，统一 token 检查、保存和 SSE 收尾 |
| 中 | `server/features/approval.js:192-304` | `check()` 同时算忽略、规则、越界、重复、自动批准、刹车和等待用户 | 按现有段落拆成几个完整业务动作，仍留在同一个文件 |
| 中 | `server/features/agents.js:17-148`、`commands/settings.js:29-222` | 业务函数之前先出现 150–220 行定义和归一化 | 只调整文件内顺序，把 `list()` / `read()` 提到前面 |
| 中 | `frontend/src/commands/config.js:43-159`、`settings.js:121-234`、`session.js:334-437` | 三个转换函数都超过一屏，嵌套到 4–5 层 | 按 providers / permission / mcp / history 分段拆开 |
| 中 | `server/features/approval.js:142-156` | 对内部配置反复判断对象和空值 | 在 `Config.read/set` 归一化一次，使用点直接信任 |
| 中 | `server/features/agents.js:150-175`、`commands/session.js:203-220`、`frontend/src/commands/settings.js:138-159`、`session.js:340-356` | 连续 5–18 行没有步骤注释 | 只补右侧短注释，不改代码 |
| 中 | `server/commands/session.js:758-804` | `partial` 是外部输入，类型检查藏在 `appendPartial`，传错时仍返回 `ok: true` | 在 `stop` 开头检查并抛 `fail(400, ...)` |
| 中 | `frontend/src/i18n.js:35-68` | 英文表和 `store` 引入都不会被用到 | 要么删掉英文表并改文件头，要么真正读语言设置 |
| 中 | `frontend/src/commands/tabs.js:12-22`、`workspace.js:11-21` | `restore()` 和 `activeWorkspaceID` 没有调用方 | 要么接上启动恢复，要么删掉并改文件头 |
| 低 | `frontend/src/session/tools/views/*.vue`、`utils/sse.js`、`server/tools/control.js` 等 | 文件头没有可复制的调用示例 | 每个文件补 3–5 行头注释 |
| 低 | `server/features/delegation.js:25-30`、`frontend/src/session/tool-ui.js:31-45` | `new_task` 的 UI 和工具别名各存两份 | `/tool/list` 已经下发 UI，删掉前端兜底；别名等接口一起下发 |
| 低 | `server/features/approval.js:34,48`、`features/boundary.js:36,47`、`features/rules.js:39`、`features/agents.js:71` | `stable`、`flatten`、`real`、`inside`、`text` 这类名字说不清是什么 | 就地改成 `stableKey`、`flattenInput`、`realPath`、`isInside`、`readConfigText` |

## 检查清单

| # | 原则 | 状态 | 说明 |
| --- | --- | --- | --- |
| 1 | 按主体组织 | 部分 | 主体文件基本清楚；`features/` 是技术角色名，改目录需要确认 |
| 2 | 加删只动一处 | 部分 | 设置页、智能体、类别已经收口；工具类别仍要改中央表 |
| 3 | 数据一个来源 | 部分 | 默认值、标题、智能体兜底已收口；模型形状和会话历史仍是多处 |
| 4 | 流程一条线 | 部分 | 入口不再比较默认值，`workspaceId` 已修；`run()` 和 `approval.check()` 仍偏长 |
| 5 | 打开就懂 | 部分 | 新改的文件都有头注释；一些工具视图和 `sse.js` 还缺调用示例 |
| 6 | 装得下 | 部分 | 三个转换函数和 `run()` 超过一屏，已列入上表 |
| 7 | 平铺直叙 | 通过 | 没发现回调套回调或事件总线式分发 |
| 8 | 信任内部数据 | 部分 | 工具有第二参兜底和 `partial` 检查位置不对；其余边界检查基本在入口 |
| 9 | 说人话 | 部分 | 业务名总体清楚；几个局部函数名和三个文件名需要改，已列入上表 |
| 10 | 注释讲业务 | 部分 | 主要流程有右栏注释；上面列出的几段连续缺注释 |
| 11 | 修问题做减法 | 通过 | 本轮删掉了 `DEFAULTS`、两个死导出和重复默认值 |
| 12 | 改到哪里整理到哪里 | 部分 | 本轮动过的文件已补注释和文档；未动的旧文件保持原样 |

## 上游组件库问题

这些问题不是本项目写法错误，已经记录在 KIMA 仓库：

- `kernel4632/kima#9`：`KimaSelect` 在 Vue 模板里读 `document`，Teleport 恒为 disabled 并持续警告。
- `kernel4632/kima#10`：缺少 `KimaMarkdown`，本项目只能在 `ui/KimaMarkdown.vue` 里按块组合 `KimaTypography` 和 `KimaCodeBlock`。

另外本轮发现但还没提 issue 的上游限制：

- `KimaCommand` 总会渲染触发按钮，没有隐藏触发器的 prop，命令面板暂时没法直接换过去。
- `KimaCard` 没有 padding/radius/size prop，紧凑行只能覆盖内部类。
- `KimaListbox` 没有无底色变体，权限抽屉只能覆盖内部样式。
- `KimaRadioGroup` 的单选圆点固定渲染，智能体抽屉只能用 `order` 调整位置。

## 验证

- 后端：`cd server && bun test`，215 个测试通过。
- 前端：`cd frontend && bun run test`，24 个测试通过；`bun run build` 通过。
- 界面：`cd frontend && bun run test:ui` 覆盖桌面和手机两套视口，结果见本轮提交说明。
