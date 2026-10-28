# HOP 接手审查

审查日期：2026-10-28。范围：`server/` 与 `frontend/src/` 的业务代码；不含 `node_modules/`、`dist/`、测试夹具和 KIMA 源码。

结论：**严格审查过的 12 条原则里，10 条通过，2 条部分通过（第 3、10 条）。** 这一轮修掉了回退顺序、删除会话缓存、`tools/` 混入非工具、`ui/` 绕过适配层、前后端智能体清单重复、`session.js` 过长等问题；剩下的重复集中在前后端都要用的显示元数据，已经在下面单独列出，不再假装“全部通过”。

## 一、十二原则逐条清点

| # | 原则 | 状态 | 证据与说明 |
| --- | --- | --- | --- |
| 1 | 按主体组织 | `[x]` 通过 | 后端 `session/` 按动作分成 `session.js`（会话资料）、`agent.js`（装配 Agent）、`run.js`（发送和停止）、`read.js`（读取）、`rollback.js`（回退）、`history.js`、`snapshot.js`、`title.js`、`meta.js`。`config/`、`safety/` 各自一组；根目录只留工具、技能、MCP、斜杠命令、工作区等主体文件。 |
| 2 | 加删只动一处 | `[x]` 通过 | 加工具只往 `server/tools/` 放一个文件，写 `name`、`kind`、可选 `files(input)`；扫描器自动登记。`truncate.js`、`diagnose.js` 已移出 `tools/`，`tools/` 里现在每个文件都是真工具。`new_task` 和 `skill` 是运行时工具，不放在 `tools/`，不属于可增删的文件工具。 |
| 3 | 数据一个来源 | `[~]` 部分 | 会话历史只由 `session/history.js` 管；`Store.sessions` 已删除，读、回退、同步都走 `History`。删除会话会同时清掉历史缓存。**仍然重复**：前端 `USE_LABELS`、`defaults.js`、`usageFields` 与后端用途标签、默认值、用量字段各有一份，详见第三节。 |
| 4 | 流程一条线 | `[x]` 通过 | 发消息：`Session.send()` → `run.js` 的 `validateRun()` → `startRun()` → 收尾函数。回退：`Session.rollback()` → `rollback.js`，文件恢复前先校验消息。审批：`Approval.check()` 按固定顺序调用具名小函数。 |
| 5 | 打开就懂 | `[x]` 通过 | `server/`、`frontend/src/` 的源文件都以文件头开头；工具、会话、配置、核心组件都补了“调用示例”。测试文件只保留文件头，不写调用示例，因为它们不是被别人 import 的模块。 |
| 6 | 装得下 | `[x]` 通过 | 最长业务函数是 `frontend/src/session/session.js` 的 `normalizeMessage()`（56 行）和 `normalize()`（54 行）；其余业务函数在 45 行以内。`server/session/run.js` 拆成启动、模型事件、工具事件、落盘、审批几个小函数。 |
| 7 | 平铺直叙 | `[x]` 通过 | 没有继承、事件总线或字符串反射；入口直接调主体，主体直接调下一层。前端事件按类型分派，但每个分支只调用一个具名函数。 |
| 8 | 信任内部数据 | `[x]` 通过 | `History.add()`、`History.get()` 在没加载历史时直接报错，不再悄悄建空历史；`stop()` 只在入口检查 `partial`；`appendPartial()` 不再重复检查类型。 |
| 9 | 说人话 | `[x]` 通过 | `startHandler`、`llmHandlers`、`toolResultHandler`、`stepHandler`、`permissionHandler` 已改成 `startAgent`、`modelEvents`、`sendToolResult`、`saveStep`、`askBeforeTool`；`createShortcutHandler` 改成 `shortcutListener`。 |
| 10 | 注释讲业务 | `[~]` 部分 | 关键流程有右侧步骤注释和“为什么”注释；少数数据表、兼容映射和简单赋值没有逐行注释。HOP 要求一段里大多数行都有，这一条还没有做到全项目一致。 |
| 11 | 修问题做减法 | `[x]` 通过 | 回退先校验再动文件；删除会话清缓存；工具目录不再二次扫描；`truncate/diagnose` 移出工具目录；前端删掉 `FALLBACK_AGENTS` 和旧 `modes` 兜底。没有用新增判断掩盖问题。 |
| 12 | 改到哪里整理到哪里 | `[x]` 通过 | 这一轮改过的文件同步了文件头、命名、缩进和文档路径；`server/README.md`、`frontend/docs/API.md`、`frontend/docs/HOP-REFACTOR.md`、`frontend/src/ui/README.md` 的旧路径和旧数字已更新。 |

## 二、这一轮修掉的具体问题

- `[x]` **回退顺序**：`History.idsBefore()` 找不到消息时先抛 404，`Session.rollback()` 不会再在报错前改文件；补了回归测试。
- `[x]` **删除会话**：新增 `History.remove()`，`Session.remove()` 同时清掉历史缓存；健康检查的会话数会和磁盘一致。
- `[x]` **工具目录**：`tools/truncate.js`、`tools/diagnose.js` 移到 `utils/`；`tools/` 里每个文件都是真工具，扫描器不再需要“没有 name 就跳过”的兜底。
- `[x]` **单文件目录**：`server/defaults/system-prompt.js` 移到根目录 `server/system-prompt.js`，删除 `defaults/`。
- `[x]` **组件库边界**：`ui/index.js` 转出业务用到的全部 KIMA 组件；19 个业务文件改成从 `ui/index.js` 导入。`ui-boundary.test.js` 现在会报出任何直接 import KIMA 的业务文件。
- `[x]` **智能体清单**：前端删除 `FALLBACK_AGENTS` 和 `raw.modes` 兜底，智能体目录只来自后端 `/agent/list`；设置页仍从 `raw.agents` 读自定义定义用于编辑。
- `[x]` **类别和旧工具名**：`/tool/list` 每项带 `kindLabel`、`kindHint`、`previousNames`；`/tool/kinds` 给自动批准开关提供类别、名字和顺序。前端不再存类别表或旧工具名表，全部从后端取。
- `[x]` **会话文件拆分**：`session/session.js` 从 900 行降到 275 行；运行、回退、读取、Agent 装配分别进独立文件。
- `[x]` **长函数拆分**：`frontend/src/session/chat.js` 的 `receiveRun()` 拆成按事件命名的小函数；`server/utils/sse.js` 的响应过滤拆成 `sseBody()`。
- `[x]` **命名**：所有 `handler` 类架构词已从业务源码清掉。
- `[x]` **文件头**：工具、组件、会话模块补齐调用示例；`model-icon-assets.js` 的示例改成真实导出的 `modelIconSvg()`。

## 三、仍然存在的重复（下一轮要处理）

这些不是“忘了改”，是前后端都需要同一份显示数据。当前用契约测试盯住，下一轮应改成后端返回元数据、前端只消费。

| 位置 | 重复内容 | 现在怎么保证不漂移 |
| --- | --- | --- |
| `frontend/src/session/session.js` `USE_LABELS` | 压缩、标题等用途标签 | 与 `server/config/settings.js` 的 `USES` 对应 |
| `frontend/src/defaults.js` | 会话默认值、上下文窗口、未命名标题 | 跨进程最小默认值，后端 `defaultSettings()` 是运行期来源 |
| `frontend/src/session/chat.js` `usageFields`、`frontend/src/session/session.js` `normalizeRequest`、`server/session/run.js` `usageOf` | token 用量字段 | 三处都识别同一组输入/输出/缓存字段，服务端已经统一输出一套 |

如果要彻底消灭这些重复，需要新增一个只读元数据接口（例如 `/config/meta`），并让前端启动时取一次。那会改 HTTP 契约，必须同时改 `openapi.json`、`server/README.md`、`frontend/src/api.js`，所以没有在这一轮擅自做。

## 四、其他没有做到完美的地方

- `frontend/src/settings/pages/*.vue` 里有几个包装页只做 `draft` 字段到原设置组件的映射。它们不是纯转手，因为原组件接口不同；但确实多了一层文件。下一轮可以合并成真正的页面组件。
- `server/session/run.js` 的 `finishSuccess()` 里仍有三次“stop 或新 run 接管”的检查。它们是 `await` 之后必须重新确认的时序保护，不是重复输入校验；为了不改变 stop 的终态所有权，暂时保留。
- `frontend/src/app/Toast.vue` 仍复制 KIMA 0.9.7 的通知样式，这是上游作用域哈希问题的临时兼容；issue #13 修复后删除。
- 测试文件没有“调用示例”，因为它们不被其他代码 import；文件头只说明测试范围。

## 五、接手顺序

1. 先读 `AGENTS.md`、`NOTES.md` 和本文件，再看第三节的重复项。
2. 跑验证：`cd server && bun test`；`cd frontend && bun run test`；`cd frontend && bun run build`；界面改过再跑 `cd frontend && bun run test:ui`。
3. 加工具只改 `server/tools/` 一个文件；写 `name`、`kind`，需要文件快照就写 `files(input)`。
4. 改会话发送、停止、回退时，先看 `session/run.js` 和 `session/rollback.js` 的收尾顺序，再动代码。
5. 要消灭第三节的重复，先定 HTTP 元数据契约，再同时改三处文档和前端 `api.js`。

## 六、本轮验证

- 后端：`cd server && bun test` → 221 pass，0 fail。
- 前端单测：`cd frontend && bun run test` → 35 pass，0 fail。
- 前端构建：`cd frontend && bun run build` → 通过。
- 界面：`cd frontend && bun run test:ui` → 102 pass，0 fail（桌面 + 手机）。

## 七、不要误判的边界

- `server/openapi.json`、`server/README.md`、`frontend/src/api.js` 是同一份 HTTP 契约的三处记录，改一处必须三处一起改；这不是普通重复数据。
- 旧工具名的兼容映射仍在 `server/tool-names.js`；前端从 `/tool/list` 的 `previousNames` 读取，不再自己存一份。用户已确认不需要旧版本兼容，但旧会话历史里可能还有旧名字，删除前要先确认没有旧数据要打开。
- 旧会话的 token 是估算值，标记在 `frontend/src/session/stats.js` 和面板的“估算”徽标里；不要把它改成精确值。
- KIMA 必须保持最新版；升级前看 `D:\kernyr\KIMA` 的源码和发布说明，升级后在同一个提交里跑前端单测、构建和完整界面检查。
- 本文件是接手清单，不是“12/12 完美”的证明。第 3、10 条仍是部分通过，原因写在上面。
