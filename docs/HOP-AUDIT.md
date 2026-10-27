# HOP 接手审查

审查日期：2026-10-28。范围：`server/` 与 `frontend/src/` 的业务代码；不含 `node_modules/`、`dist/`、测试夹具和 KIMA 源码。

结论：**代码层已清掉能安全清掉的问题；结构层还有 3 项、长函数还有 4 处没有动。** 后两类会改目录、数据所有权或跨文件契约，按 HOP 第 12 条需要先确认，所以没有擅自改。下面每一项都能落到文件和行号。

## 一、十二原则逐条清点

| # | 原则 | 状态 | 证据与说明 |
| --- | --- | --- | --- |
| 1 | 按主体组织 | `[ ]` 部分 | 会话、设置、工具都按主体分了文件；但 `server/features/`、`server/commands/` 是技术角色名，不是商品目录。没有把一个主体拆进多层，属于可以继续用的旧结构。 |
| 2 | 加删只动一处 | `[ ]` 部分 | 工具会自动扫描 `server/tools/`；但新增工具仍要登记 `server/utils/tool-kind.js:41` 和 `server/utils/tool-files.js:19`。漏登记时契约测试会报错，不会静默失效。 |
| 3 | 数据一个来源 | `[ ]` 部分 | 会话历史同时存在 `server/store.js:20` 的 `Store.sessions` 和 `agent.history`，两处都能写；默认值、旧工具别名在前端和后端各有一份，靠契约测试同步。 |
| 4 | 流程一条线 | `[~]` 部分 | 入口到指令的路径清楚；`run()` 和 `Approval.check()` 内部仍有较长的条件链，见下面的长函数表。 |
| 5 | 打开就懂 | `[x]` 通过 | 全部 `.js` / `.vue` 源文件都有文件头；本轮补齐了 11 个工具视图、`use-tool-content.js`、`utils/sse.js`。检查脚本：每个源文件都以 `/*`、`//` 或 `<!--` 开头。 |
| 6 | 装得下 | `[ ]` 部分 | 4 个函数超过一屏，已列在长函数表；其余业务函数基本在一屏内。 |
| 7 | 平铺直叙 | `[x]` 通过 | 没有继承、事件总线或字符串分发；入口直接调指令。 |
| 8 | 信任内部数据 | `[~]` 部分 | `stop()` 的 `partial` 现在是入口检查，传错返回 400；`Approval.remember()` 里仍有对配置对象的重复形状判断，见剩余问题。 |
| 9 | 说人话 | `[x]` 通过 | 本轮把 `stable/flatten/real/inside/text` 改成 `stableKey/flattenInput/realPath/isInside/readText/cleanText`；业务文件名仍受第 9 条结构项影响。 |
| 10 | 注释讲业务 | `[~]` 部分 | 文件头、关键流程和原因注释都在；长函数里仍有连续几行没有右侧短注释，拆函数时一起补，不要单独堆注释。 |
| 11 | 修问题做减法 | `[x]` 通过 | 本轮删掉了没有调用方的标签恢复、工作区恢复、英文翻译表、前端 `new_task` UI 兜底；`stop` 检查从深处移回入口。 |
| 12 | 改到哪里整理到哪里 | `[x]` 通过 | 本轮改过的文件都补了文件头、命名或注释；没有改对外接口、字段或已存数据。 |

## 二、本轮已经打勾的改动

- `[x]` 补齐文件头：`frontend/src/session/tools/views/*.vue`、`session/tools/use-tool-content.js`、`utils/sse.js`。
- `[x]` 删除死代码：`frontend/src/commands/tabs.js` 的 `restore/sessionTabsKey`，`commands/workspace.js` 的 `activeWorkspaceID/rememberWorkspace`，`i18n.js` 的英文表和未使用的 `store` 引入，`session/tool-ui.js` 的 `NEW_TASK_UI` 兜底。
- `[x]` 改名：`server/features/boundary.js` 的 `real/inside` → `realPath/isInside`；`approval.js` 的 `stable/flatten` → `stableKey/flattenInput`；`rules.js/agents.js` 的 `text` → `readText/cleanText`。
- `[x]` `stop()` 在入口检查 `partial` 形状，错误返回 400；补了 `resume.test.js` 回归断言。
- `[x]` 短会话首条是助手消息时，可见窗口不再跳过它；审批用例连续跑 10 次通过，不再间歇性找不到“等待你的许可”。
- `[x]` KIMA 内部图标和 `AppIcon` 都统一到 1.5px，见 `frontend/src/styles/base.scss` 与 `frontend/src/theme/index.js`。

## 三、需要你确认的结构改动

这些不是漏掉，是 HOP 要求先问人。每一项都会改多个文件的路径或数据所有权。

1. **让工具自己声明类别和文件参数**
   - 现在：新增一个内置工具，除了 `server/tools/<name>.js`，还要改 `utils/tool-kind.js` 和 `utils/tool-files.js`。
   - 建议：工具导出 `kind` 和 `files(input)`，扫描器建一张运行时表；`Kind.of()` 和 `toolFiles()` 读表。
   - 影响：所有内置工具文件、扫描器、契约测试；删掉两个中央表。确认后再做。

2. **会话历史只留一个写入者**
   - 现在：`Store.sessions` 和 `agent.history` 都能写，`run()` 里用保存队列把两边同步。
   - 建议：明确 `agent.history` 是运行期唯一真相，磁盘只由 `syncHistory` 写入；或反过来让 Store 只读。要处理 stop、回退、断线恢复三条路径，改动面大。
   - 影响：`server/store.js`、`commands/session.js`、回退和恢复测试。确认后再做。

3. **把技术角色目录改成主体名**
   - 现在：`server/features/`、`server/commands/`、`features/delegation.js`、`features/commands.js`、`commands/tools.js` 仍是技术角色名。
   - 建议：按主体改成 `subtask.js`、`slash-commands.js`、`tool-catalog.js`，目录按业务分组；需要同步所有 import 和测试路径。
   - 影响：大范围移动文件，不改业务行为。确认后再做。

## 四、还没拆的长函数

| 位置 | 现状 | 建议拆法 | 风险 |
| --- | --- | --- | --- |
| `server/commands/session.js:604-794` | `run()` 约 190 行；成功、失败、继续失败三条收尾路径各抄了一遍检查 | 先抽 `finishResumeError()`，再抽 `finishSuccess()` 和 `finishFailure()`，保留现有 token 检查顺序 | 中高：stop/继续/断线恢复都走这里，拆完必须跑 `resume.test.js` |
| `server/features/approval.js:192-304` | `check()` 约 112 行，顺序是 ignore → never → deny → 工作区外 → 重复/刹车 → 自动批准 → 等待 | 按现有段落抽 `blockedByIgnore()`、`externalDecision()`、`autoDecision()`、`waitForUser()` | 高：安全逻辑，任何顺序变化都可能放行不该放行的工具 |
| `frontend/src/commands/session.js:350-483` | `normalize()` 约 133 行，同时处理协议转换、工具状态、待审批、统计和前端字段 | 抽 `normalizeMessage()`、`applyPending()`、`sessionView()`；统计继续走 `session/stats.js` | 中：历史格式兼容面广，拆完跑前端单测和真实旧会话 |
| `frontend/src/commands/config.js:52-160`、`commands/settings.js:121-235` | 供应商/权限/MCP/设置的转换函数都超过一屏 | 按 `providers` / `permission` / `mcp` / `appearance` 分段抽函数 | 中：设置页契约测试覆盖，改完跑 `settings.test.js` 和界面设置用例 |

## 五、剩余具体问题

| 优先级 | 位置 | 问题 | 最小修法 |
| --- | --- | --- | --- |
| 高 | `server/features/approval.js:135-156` | “始终允许”写回配置时反复判断 `config.agents`、`permission` 的形状 | 在 `Config.read/set` 统一归一化一次，写回处直接信任 |
| 中 | `server/features/agents.js:26-145` | 内置智能体定义排在 `list()` 前面，打开文件先看到一大段常量 | 把 `list/get` 提到常量前，或把 `BUILTIN` 移到文件末尾 |
| 中 | `frontend/src/i18n.js` | 现在只有简体中文，`currentLanguage()` 固定返回；以后要加语言需重新设计 | 真正接入语言设置时再加表，不要先放空表 |
| 低 | `frontend/src/commands/tabs.js` | 标签顺序不跨刷新保存，恢复代码已删 | 需要恢复时接 `localStorage`，不需要就保持现在 |
| 低 | `server/tools/grep.js` 等工具文件 | 工具元数据仍依赖中央表 | 跟第 2 项结构改动一起做 |

## 六、接手顺序

1. 读 `AGENTS.md`、`NOTES.md`、本文件；先看“需要你确认的结构改动”，不要直接动目录。
2. 跑验证：`cd server && bun test`；`cd frontend && bun run test`；`cd frontend && bun run build`；界面改过再跑 `bun run test:ui`。
3. 先决定结构三项；决定一项做一项，每项单独提交。
4. 再做长函数拆分，从风险最低的 `normalize()` 开始，最后动 `approval.check()`。
5. 每次改完对照 `docs/HOP-AUDIT.md` 更新状态，不要把“部分”改成“通过”但不写证据。

## 七、本轮验证

- 后端：`cd server && bun test` → 218 pass，0 fail。
- 前端单测：`cd frontend && bun run test` → 34 pass，0 fail。
- 前端构建：`cd frontend && bun run build` → 通过。
- 界面：`cd frontend && bun run test:ui` → 102 pass，0 fail（桌面 + 手机）。

## 八、不要误判的边界

- 这些是**有意保留**的跨进程契约，不是重复数据：`server/openapi.json` 与 `server/package.json` 的版本号、前后端各自需要的最小默认值。修改时必须两边一起改，并有契约测试。
- 旧会话的 token 是估算值，标记在 `frontend/src/session/stats.js` 和面板的“估算”徽标里；不要把它改成精确值。
- `docs/HOP-AUDIT.md` 是接手清单，不是“已经 12/12 完美”的证明。第 1、2、3、6 项目前仍是部分通过，原因写在上面。
