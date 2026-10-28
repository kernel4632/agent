# HOP 接手审查

审查日期：2026-10-28。范围：`server/` 与 `frontend/src/` 的业务代码；不含 `node_modules/`、`dist/`、测试夹具和 KIMA 源码。

结论：**严格重审后，12 条里 4 条通过、8 条部分通过。** 这一轮先修真实故障：`UNTITLED` 未定义、MCP/子任务/审批提示的 SSE 投递、空请求体返回 500、请求头 JSON 解析、`/agent` 重复路由、删除会话不清 SSE。结构上把工具拆成一文件一工具，并让工具目录每轮重扫。剩下的问题主要是会话门面、设置页包装、默认值重复、长函数和注释密度。

## 一、十二原则逐条清点

| # | 原则 | 状态 | 证据与说明 |
| --- | --- | --- | --- |
| 1 | 按主体组织 | `[~]` 部分 | 根目录只留 `server.js`、项目配置和文件夹；业务代码按 `session/`、`config/`、`safety/`、`tool/`、`workspace/`、`state/` 分组。`session/` 已按运行、读取、回退、资料、Agent 装配分开；但 `session.js` 仍把 `read/run/rollback` 原样转出，入口仍调 `Session.send`。设置页 `pages/*.vue` 也还有一层只做字段映射的包装。 |
| 2 | 加删只动一处 | `[x]` 通过 | `tools/` 现在一个文件一个工具：`read-file`、`write-file`、`list-files`、`attempt-completion`、`ask-followup` 已拆开。扫描器每轮清空登记再扫，删掉文件后立即消失，并有测试。`new_task`、`skill` 是运行时工具，不属于文件工具。 |
| 3 | 数据一个来源 | `[~]` 部分 | 历史、类别、用途、旧工具名、token 用量都已收口；剩下的重复是 `frontend/src/defaults.js` 的前端最小默认值，用于首屏和组件 props 初始化。 |
| 4 | 流程一条线 | `[x]` 通过 | MCP 错误、子任务进度、审批刹车和工具拦截都发回会话自己的 SSE；`permission-blocked` 带 `callID`；`/agent` 只注册一段。空请求体在入口变成 400，坏请求头在配置边界变成 400。 |
| 5 | 打开就懂 | `[x]` 通过 | `server/`、`frontend/src/` 的源码文件都有文件头和调用示例；`base.scss`、`tokens.scss`、`conversation.scss` 也补了说明。`api.js` 缩进和 `store.js` 数据清单已整理。 |
| 6 | 装得下 | `[~]` 部分 | `subtask.build()` 已拆出 `runSubtask()`；仍有 `normalizeMessage()` 56 行、`normalize()` 54 行、`smooth-text` 56 行、`stats` 53 行。 |
| 7 | 平铺直叙 | `[x]` 通过 | 没有继承、事件总线或字符串反射；入口直接调主体。 |
| 8 | 信任内部数据 | `[~]` 部分 | 历史读写未加载时直接报错；`Config.load` 删除了逐接口“旧后端”兜底；工具目录对坏文件只跳过并记录。但旧会话 `content`/旧工具名兼容仍在，见第四节。 |
| 9 | 说人话 | `[~]` 部分 | 架构词 `handler` 已清掉；`providerPayload`、`permissionPayload`、`mcpPayload`、`backendSnapshot`、`isolateDraft`、`persistQueue` 仍是技术味较重的名字。 |
| 10 | 注释讲业务 | `[~]` 部分 | 关键流程和危险点有注释；`Composer.vue`、`SessionStats.vue`、`SettingsPage.vue`、`AgentsPage.vue` 等大组件仍然稀疏，远没到“一段里大多数行右边都有说明”。 |
| 11 | 修问题做减法 | `[~]` 部分 | 这一轮修的是源头：SSE 统一用会话 id、工具目录重建、空 body 在入口处理。旧工具别名和旧会话格式的兼容代码仍在。 |
| 12 | 改到哪里整理到哪里 | `[~]` 部分 | 路由表、工具数量、接口数量、设置页说明、KIMA 版本都更新了；`HOP-REFACTOR.md` 仍是历史计划，不能当作当前结构说明。 |

## 二、这一轮修掉的真实故障

- `[x]` **`UNTITLED` 未定义**：`server/session/run.js` 补回常量。之前第一次成功跑完一轮、自动起标题时会抛 `ReferenceError`，`agent-finish` 不会发出。
- `[x]` **SSE 投递**：`Mcp.tools({ sessionId })`、`subtask` 的事件都改用会话 id；`permission-blocked` 带 `callID`；`permission-limit` 前端会提示；删除会话时调用 `SSE.close`。
- `[x]` **路由和边界**：`/agent` 不再注册两段；`POST /session/create` 空 body 返回 400；供应商请求头坏 JSON 返回 400。
- `[x]` **工具一文件一工具**：`file.js`、`control.js` 拆成 5 个文件；工具目录每轮重建，删文件后下一次列目录立即消失。
- `[x]` **坏工具文件隔离**：用户 `tools/` 里语法错误或没有 `name` 的文件只跳过并记录，不再拖垮整个目录和会话创建。
- `[x]` **前端兼容分支**：`Config.load` 不再为每个接口写“旧后端没有”的 `try/catch`；正文增量只认 `text`，工具结果只认 `output`。
- `[x]` **KIMA 0.9.9**：通知样式已由上游修好，`Toast.vue` 不再复制组件样式，只保留位置上移。

## 三、仍然存在的重复

| 位置 | 重复内容 | 现状 |
| --- | --- | --- |
| `frontend/src/defaults.js` | 会话默认值、上下文窗口、未命名标题 | 首屏和组件 props 初始化要用，后端此时还没返回；保留为跨进程最小默认值 |
| `frontend/src/composer/reasoning.js` 与 `server/config/settings.js` | 思考强度七档 | 前端有标签和图标，后端有合法值列表；加一档仍要改两处 |

## 四、其他没有做到完美的地方

- `session/session.js` 仍是门面：CRUD 之外把 `read/run/rollback` 转出。HOP 第 1 条更希望入口直接调各自主体，但那样会改掉现有 `Session` 调用面和大量测试。
- 设置页 `pages/*.vue` 里有几个包装页只做字段映射，真正界面在 `components/*.vue`。
- `frontend/src/settings/settings.js` 的 `payload`、`persist` 命名还可以更白话。
- 大组件注释稀疏，第 10 条没有全项目达标。
- 旧工具名映射和旧会话 `content` 兼容仍保留；用户已确认不需要旧版本兼容，但删之前要确认没有旧数据要打开。
- `finishSuccess()` 里三次“stop 或新 run 接管”的检查是 `await` 后的时序保护，不是重复输入校验，暂时保留。

## 五、接手顺序

1. 先读 `AGENTS.md`、`NOTES.md` 和本文件。
2. 跑验证：`cd server && bun test`；`cd frontend && bun run test`；`cd frontend && bun run build`；界面改过再跑 `cd frontend && bun run test:ui`。
3. 加工具只改 `server/tools/` 一个文件；写 `name`、`kind`，需要快照就写 `files(input)`。
4. 改发送、停止、回退时先看 `session/run.js` 和 `session/rollback.js` 的收尾顺序。
5. 继续 HOP 化时，优先处理会话门面、设置页包装、长函数和注释密度；不要先动 HTTP 契约。

## 六、本轮验证

- 后端：`cd server && bun test` → 225 pass，0 fail。
- 前端单测：`cd frontend && bun run test` → 35 pass，0 fail。
- 前端构建：`cd frontend && bun run build` → 通过。
- 界面：`cd frontend && bun run test:ui` → 102 pass，0 fail（桌面 + 手机）。

## 七、不要误判的边界

- `server/openapi.json`、`server/README.md`、`frontend/src/api.js` 是同一份 HTTP 契约的三处记录，改一处必须三处一起改。
- 旧会话的 token 是估算值，标记在 `frontend/src/session/stats.js` 和面板的“估算”徽标里。
- KIMA 必须保持最新版；升级前看 `D:\kernyr\KIMA` 的源码和发布说明，升级后跑单测、构建和完整界面检查。
- 本文件是接手清单，不是“12/12 完美”的证明。第 1、3、6、8、9、10、11、12 条仍是部分通过。
