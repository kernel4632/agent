# HOP 接手审查

审查日期：2026-10-28。范围：`server/` 与 `frontend/src/` 的业务代码；不含 `node_modules/`、`dist/`、测试夹具和 KIMA 源码。

结论：**12 条原则已全部通过。** 目录、数据所有权和长函数都已按 HOP 重排；剩下的是外部依赖和回归风险，不再有“需要先问人才能动”的结构项。下面每条都能落到文件和函数。

## 一、十二原则逐条清点

| # | 原则 | 状态 | 证据 |
| --- | --- | --- | --- |
| 1 | 按主体组织 | `[x]` 通过 | 后端按主体分成 `session/`、`config/`、`safety/`，根目录只留 `mcp.js`、`skills.js`、`subtask.js`、`slash-commands.js`、`tool-catalog.js`、`workspace.js` 各一个主体。旧 `commands/`、`features/` 已删除。前端按 `app/`、`session/`、`settings/`、`composer/`、`draft/` 分组，旧 `commands/` 已删除。 |
| 2 | 加删只动一处 | `[x]` 通过 | 加一个工具只往 `server/tools/` 放一个文件，文件里写 `name`、`kind`、可选 `files(input)`。`tool-catalog.js` 扫描时登记到 `utils/tool-kind.js` 和 `utils/tool-files.js`，没有中央名单要同步。删掉文件工具就消失。 |
| 3 | 数据一个来源 | `[x]` 通过 | 会话历史的内存缓存只在 `server/session/history.js` 里，别处通过 `History` 读写；`Store.sessions` 已删除。运行期消息在 `agent.history`，磁盘只由 `syncHistory` 写。配置只由 `Config` 读写。 |
| 4 | 流程一条线 | `[x]` 通过 | 发消息：`run()` → `validateRun()` → `startRun()` → `finishSuccess/Failure/ResumeError()`。审批：`check()` 按 ignore → 内部工具 → deny → 工作区外 → 重复/刹车 → 自动批准 → 等待 的顺序调用具名小函数。 |
| 5 | 打开就懂 | `[x]` 通过 | 每个 `.js`、`.vue` 源文件都以文件头开头；文件头写“管什么、调用示例”。新增的 `validateRun`、`startRun`、`permissionHandler` 等都有业务注释。 |
| 6 | 装得下 | `[x]` 通过 | 最长业务函数是 `frontend/src/session/session.js` 的 `normalizeMessage()`，56 行；其次是 `normalize()` 54 行。其余业务函数都在 45 行以内。`RUN_EVENTS` 是事件名集合，不是函数。 |
| 7 | 平铺直叙 | `[x]` 通过 | 没有继承、事件总线或字符串分发；入口直接调用主体，主体直接调用下一层。 |
| 8 | 信任内部数据 | `[x]` 通过 | `stop()` 的 `partial` 在入口检查；`Approval.remember()` 通过 `writableRules()` 一次修好配置形状，不再在写回处反复判断。只有跨进程输入和旧配置做兼容。 |
| 9 | 说人话 | `[x]` 通过 | 业务文件名和函数名都是日常词：`startRun`、`outsideWorkspace`、`repeatsTooOften`、`toolResultHandler`、`mergeAutoApprove`。没有 `manager`、`helper`、`util` 这类空名。 |
| 10 | 注释讲业务 | `[x]` 通过 | 注释解释“为什么”，不重复代码。例如审批的 `waitForUser` 说明为什么不能先 `await`，历史说明为什么不能整条克隆。 |
| 11 | 修问题做减法 | `[x]` 通过 | 删掉了旧目录、两个中央工具表、重复的收尾检查、`normalize()` 里的一次性大函数、前端旧 `commands/`。没有新增兼容层或空框架。 |
| 12 | 改到哪里整理到哪里 | `[x]` 通过 | 这一轮改过的文件都同步了文件头、命名、注释和文档路径。`server/README.md`、`frontend/docs/API.md`、`frontend/docs/HOP-REFACTOR.md`、`NOTES.md` 里的旧路径已清理。 |

## 二、这一轮的结构改动

- `[x]` 后端按主体重排：`session/session.js`、`session/history.js`、`session/snapshot.js`、`session/title.js`；`config/config.js`、`config/settings.js`、`config/agents.js`、`config/rules.js`；`safety/approval.js`、`safety/boundary.js`、`safety/ignore.js`。
- `[x]` 工具自声明：工具文件带 `kind`，需要碰文件的再带 `files(input)`；扫描器登记，审批、只读模式和快照都读同一张运行时表。
- `[x]` 历史单一所有者：`History` 自己持有缓存，`Store` 不再保存会话历史；删除 `Store.sessions` 后，测试统一调 `History.clear()`。
- `[x]` `run()` 拆分：发送前校验、启动和三条收尾路径分开；Agent 事件回调按“开始 / 模型请求 / 转发 / 工具结果 / 落盘 / 审批”拆成小函数。
- `[x]` `Approval.check()` 拆分：忽略规则、权限规则、工作区外、重复调用、自动批准、等待用户分别成函数，判断顺序保持不变。
- `[x]` 前端归一化拆分：`partList`、`normalizeTool`、`applyToolResult`、`normalizeRequest`、`normalizeMessage`、`normalize` 各做一件事。
- `[x]` 前端配置和设置拆分：供应商、工具目录、MCP、默认模型、智能体各自转换；保存时供应商、权限、MCP、整份配置分开组装。
- `[x]` KIMA 升级到 `0.9.7`；通知样式的上游作用域哈希错误用 `frontend/src/app/Toast.vue` 临时兼容，已向上游提交 issue #13。

## 三、长函数清单

| 位置 | 当前长度 | 说明 |
| --- | --- | --- |
| `frontend/src/session/session.js` `normalizeMessage()` | 56 行 | 一次只处理一条消息，内部已按 tool/result、文本、步骤分开。 |
| `frontend/src/session/session.js` `normalize()` | 54 行 | 只做会话级拼装，协议细节已移到上面几个函数。 |
| `server/config/config.js` `resolve()` | 45 行 | 模型连接配置合并；再拆会把一处顺序拆散，暂不再动。 |
| `server/session/session.js` `agentTools()` | 43 行 | 工具扫描和裁剪；步骤本身就是一条直线。 |
| `frontend/src/settings/settings.js` `open()` | 43 行 | 读取草稿；每个字段一行，拆开反而难对照。 |

## 四、剩余风险和外部依赖

1. **KIMA Notification 上游问题**：`@kernel4632/kima@0.9.7` 的组件作用域哈希是 `data-v-8f69e04e`，`dist/style.css` 里仍是旧哈希 `data-v-1c6f5605`。`Toast.vue` 里复制了本应用实际用到的通知样式。上游修复后删掉这段兼容样式，并重新跑 320px 界面用例。issue：https://github.com/kernel4632/kima/issues/13
2. **审批顺序是安全边界**：`Approval.check()` 的顺序不能随意调整。改这里必须跑 `server/tests/approval.test.js`、`boundary.test.js`、`settings.test.js` 和完整 `bun test`。
3. **前端旧会话格式**：`normalizeMessage()` 仍兼容旧 `content` 和旧步骤顺序；用户已确认不需要兼容旧版本，但删掉兼容前要先确认没有旧会话需要打开。
4. **界面回归**：结构重排和 KIMA 0.9.7 都改过界面，任何一轮结构提交前都要跑完整 `test:ui`，不能只跑单测和构建。

## 五、接手顺序

1. 先读 `AGENTS.md`、`NOTES.md` 和本文件。
2. 跑验证：`cd server && bun test`；`cd frontend && bun run test`；`cd frontend && bun run build`；界面改过再跑 `cd frontend && bun run test:ui`。
3. 加工具只改 `server/tools/` 一个文件；需要审批分类就写 `kind`，需要快照就写 `files(input)`。
4. 改会话或审批时，先看本文件的“剩余风险”，保留现有判断顺序。
5. 每改完一项就更新本文件，把“通过”写成有证据的通过。

## 六、本轮验证

- 后端：`cd server && bun test` → 219 pass，0 fail。
- 前端单测：`cd frontend && bun run test` → 34 pass，0 fail。
- 前端构建：`cd frontend && bun run build` → 通过。
- 界面：`cd frontend && bun run test:ui` → 102 pass，0 fail（桌面 + 手机）。

## 七、不要误判的边界

- 这些是**有意保留**的跨进程契约，不是重复数据：`server/openapi.json` 与 `server/package.json` 的版本号、前后端各自需要的最小默认值。修改时必须两边一起改，并有契约测试。
- 旧会话的 token 是估算值，标记在 `frontend/src/session/stats.js` 和面板的“估算”徽标里；不要把它改成精确值。
- KIMA 必须保持最新版；升级前看 `D:\kernyr\KIMA` 的源码和发布说明，升级后在同一个提交里跑前端单测、构建和完整界面检查。
- 本文件是接手清单，不是“代码永不再动”的证明。第 6 条的函数长度会随新代码变化，接手时重新量一遍。
