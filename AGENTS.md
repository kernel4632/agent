# agent 项目规则

## 先回到第一性原理，做减法

改代码前先问清楚：**系统里真正存在的状态和事实是什么？现在这个判断、分支、字段，是不是在弥补一个本不该存在的概念？**

- 先定义主体、状态和唯一数据来源，再决定代码怎么写；不要看到哪里报错就在哪里加 `if`、加 role、加兜底。
- 新增一种记录、事件或分支时，先检查它属于“模型协议”“运行生命周期”还是“界面展示”。三者不能混成一个 role 或一个布尔值。
- 持续追问“为什么需要这个判断”。如果换一种抽象后这个判断可以彻底消失，就选让判断消失的方案，而不是把排除列表写得更长。
- 修一个问题时优先做减法：让问题不可能再发生，而不是在出错点加一层防御。修完代码变多，要停下来重新想。
- 涉及新概念、跨层职责、数据结构、接口形状或全局判断的改动，先列出候选方案，比较单一真相、生命周期、扩展性和已有数据的影响，向用户说明后选一个；不要直接写局部补丁。普通小修不必为每一步都请示。
- 前端只展示服务端已经确认的事实。SSE 事件缺失就暴露断线/重连，不能在本地伪造“进行中”状态来掩盖后端问题。

违反这条通常的表现：同一个判断在前后端各写一遍；新增一个 UI 记录就要改三处过滤；用乐观占位让界面“看起来正常”；修完一个 bug 多出十几个分支。

## 每改完一点就提交推送，不用等确认

每完成一小步就提交并推送，不要攒着一批改动等用户确认。
这样做是为了出错时能精确回退到上一个可用的点。

这里的「一小步」指一次能说清楚的改动：修一个问题、加一项能力、一次重构。
不要把好几件不相关的事混在一个提交里。提交信息用 `feat:` / `fix:` / `chore:` 开头，一句话说清改了什么。

## 推送前必须改版本号

每次准备 `git push` 之前，先把这次改动涉及的那一半的版本号改掉，再提交。

| 改了哪一半 | 改哪个文件 |
| --- | --- |
| 后端（`server/`） | `server/package.json` 的 `version` |
| 前端（`frontend/`） | `frontend/package.json` 的 `version` |
| 两边都改了 | 两个都改 |
| CLI（`cli/`） | `cli/VERSION` |

改哪一位：

| 这次改了什么 | 改哪一位 | 例子 |
| --- | --- | --- |
| 加了新能力 | 第二位 | `0.1.0` → `0.2.0` |
| 只修了问题和文档 | 第三位 | `0.1.0` → `0.1.1` |

推送顺序固定为：改版本号 → 跑验证 → 提交 → 推送。

## 服务进程由当前 harness 管理：默认不重启，用户明确要求时可以

这个项目的 server 和 frontend 由当前 DSH harness 管理。没有用户明确要求时，不要主动杀进程或重启；需要新代码生效，先提示用户重启，或用独立 `AGENT_HOME`/端口做隔离验证。

用户明确说“重启服务”时，可以按下面步骤执行，但不要制造第二个实例：

1. 先用 `/health`、监听端口和进程链确认当前实例；不要用 `taskkill /F /T` 连坐杀父进程。
2. 停掉旧的 server 子进程，确认 3000 端口已释放。
3. 用 DSH 的后台任务启动 `bun run server.js`（工作目录 `server/`），等 `/health` 返回且版本等于目标版本。
4. 再验证 `/session/list`、`/admin {op:"config.read"}` 等只读接口，确认数据目录和配置没有被换掉。
5. 前端由 Vite HMR 更新，不需要为了新代码重启；只有构建产物或 Vite 进程异常时才处理。

历史的进程管理事故仍然是教训：

| 次数 | 错误做法 | 结果 |
| --- | --- | --- |
| 1 | 脚本里硬编码端口 3000/5173 重启 | 服务跑到错误端口，原端口 3111 的服务消失 |
| 2 | `taskkill /F /T` 连坐杀 + 自己 spawn | 和 harness 重启撞成两套进程抢端口 |
| 3 | 改进后依旧自己杀自己起 | 脚本被连带杀死，重启后校验从没执行 |

需要验证“重启后才生效”的功能，仍优先使用**完全隔离的实例**：独立 `AGENT_HOME`、独立端口、必要时起一个假模型服务顶替 provider，验证完关掉，全程不碰现有服务。具体做法见 `tmp/e2e-recovery.cjs`。

只读的诊断（查端口、查进程链、读日志、`/health`）随时可以做。

## 长任务放后台跑，不要堵住对话

会跑超过十几秒的命令一律用后台跑（`background` 工具启动，再读日志），不要用同步执行硬等。
这类命令包括：全量测试（`bun test`）、构建、Playwright 界面检查、`bun install`、拉取大仓库、批量文件处理。

同步执行只用于秒级的小命令（读一个文件、`git status`、单条 `curl`）。
判断标准很简单：**这个命令可能要等超过十秒吗？会就放后台。**
被堵住的对话里用户没法插话、没法改方向，等于把我自己的等待变成用户的等待。

## 验证命令

改完代码必须跑对应的一半，通过才算完成：

```bash
cd server && bun test        # 后端：真实启动服务端 + 真实 HTTP 请求，用临时数据目录
cd frontend && bun run build # 前端：能构建通过
cd cli && go test ./...      # CLI：HTTP/SSE 协议和终端交互
```

`bun test` 全量要跑二三十秒以上，用后台跑再读日志，别同步等。

CLI 改了请求或运行流程时，先构建 `cli/cmd/agent` 到 `tmp/cli-test/agent.exe`（Linux/macOS 无 `.exe`），再在 `cli/` 执行 `bun test tests/integration.test.js --timeout 30000`，用真实后端验证。

后端测试覆盖每一个接口，包括填错参数的情况（空标题、不存在的会话、不认识的决定）。
新加接口或改动行为时，在同一次提交里把对应的测试补上。

前端还有一套 Playwright 界面检查（`cd frontend && bun run test:ui`），它不是每次必跑，改到界面时手动跑一次。

## 临时文件不要放在根目录

调试日志、构建日志、测试截图和一次性脚本统一放进 `tmp/`，根目录只保留源码、文档和项目配置。`tmp/` 已经在 `.gitignore` 里整目录忽略；需要保留的日志放 `tmp/logs/`，用完可以随时清掉。

## 路由已冻结，不能随便新增

后端路由固定在 **19 条**，已写入测试（`server/tests/api-frozen.test.js`）。

- 加新功能优先**扩展现有路由的查询参数或请求体字段**
- 管理动作走 `/admin` 总线（`commands/admin.js` 的 `OPS` 对象），op 可以随功能扩展，不受冻结限制
- **不能新增路由**，除非用户明确说要加，或功能确实没法用现有路由实现且用户同意后
- 测试失败说明有人在试图新增路由，必须停下来问用户

## 改接口要同时改两处

前后端之间的 HTTP 契约写在这两处，任何一处变了，另一处必须跟着改，否则下次接手的人会按错的字段名写：

| 位置 | 作用 |
| --- | --- |
| `server/README.md` | 前端怎么对接（含 SSE 事件表、权限规则、错误码） |
| `frontend/src/utils/api.js` | 前端实际发出的请求 |

路由本身只在 `server/server.js` 里写一次：`bun test` 会把它和前端调用的路径对账（`frontend/tests/server-routes.js` 直接解析这个文件），另有一份手写接口清单只会漂移。

改了接口路径、请求字段、响应字段或状态码时，如果需要前端配合改代码，就在提交说明里写清楚改了什么、前端要动哪里。

## 数据目录

后端的数据都在 `AGENT_HOME` 下（默认 `%USERPROFILE%\.agent`）：

- `config.json`：模型服务、系统提示词、工具权限规则 `permission`
- `sessions/<id>/`：每条会话一个目录，放 `meta.json` 和 `history.json`
- `tools/`：用户自己写的工具，和内置工具一起扫描

开发和测试不要写用户真实的 `~/.agent`，用 `AGENT_HOME` 指向临时目录。

测试切 `AGENT_HOME` 时必须同时 `Path.lock(root)`：任务收尾是异步的，等它写盘时测试可能已经把
`AGENT_HOME` 恢复成默认值，那些晚到的写入就落到真实的 `~/.agent` 里了（曾经因此留下几十条垃圾会话）。
`Path.lock` 锁定之后本进程的路径解析不再看 `process.env`，测试的 `finally` 里解锁。

## 后端分层规则

后端分四层，同一层的文件夹内部不互相引用，这是硬约束，由 `tests/contract.test.js` 把关：

- `commands/` 之间不互相 import；一个接口一个文件，负责把请求变成参数、校验、调用 features/utils、拼响应。
- `features/` 之间不互相 import；每个文件是一个业务主体，只 import `store.js`、`utils/` 和第三方包。工具执行需要的 features 能力（如 `Tool.snapshot`、`Tool.kind`）由 commands 层通过参数传入，不在 features 里静态 import 别的 feature。
- `tools/` 只 import `store.js` 和 `utils/`，需要 features 的能力时一律从参数传入。
- `utils/` 是跨层共用的小工具。

**禁止用 `bind()` 或运行时注入绕开上面这条**：装配材料（Agent 实例需要的 session、tools、mcp、approval 等）由 commands 层传进来，features 不自己 import 别的 feature 来装配。

### 命名

导出函数采用 `主体.动作()`，动作只用一个动词：`Agent.create()`、`History.save()`、`Tool.restore()`。内部辅助函数不导出。

### 函数粒度

一个功能操作写成一个函数。只有被多处共用的逻辑才抽成独立函数，单次调用的直接内联。大函数内部用 `// --- 小标题 ---` 分隔流程段落。

### Agent 装配代码有三份

`commands/chat.js`、`commands/session.js`、`server/tests/agent-helpers.js` 各有一份装配代码（`getAgent` + `checkPermission` + 取 session/settings/tools 的逻辑）。这是有意为之：把它们抽进 `commands/assemble.js` 会让 commands 之间互相引用，违反分层约束。三份重复比一个违反架构的公共模块更好。

## 后端分层规则

后端分四层，同一层的文件夹内部不互相引用，这是硬约束，由 `tests/contract.test.js` 把关：

- `commands/` 之间不互相 import；一个接口一个文件，负责把请求变成参数、校验、调用 features/utils、拼响应。
- `features/` 之间不互相 import；每个文件是一个业务主体，只 import `store.js`、`utils/` 和第三方包。工具执行需要的 features 能力（如 `Tool.snapshot`、`Tool.kind`）由 commands 层通过参数传入，不在 features 里静态 import 别的 feature。
- `tools/` 只 import `store.js` 和 `utils/`，需要 features 的能力时一律从参数传入。
- `utils/` 是跨层共用的小工具。

**禁止用 `bind()` 或运行时注入绕开上面这条**：装配材料（Agent 实例需要的 session、tools、mcp、approval 等）由 commands 层传进来，features 不自己 import 别的 feature 来装配。

### 命名

导出函数采用 `主体.动作()`，动作只用一个动词：`Agent.create()`、`History.save()`、`Tool.restore()`。内部辅助函数不导出。

### 函数粒度

一个功能操作写成一个函数。只有被多处共用的逻辑才抽成独立函数，单次调用的直接内联。大函数内部用 `// --- 小标题 ---` 分隔流程段落。

### Agent 装配代码有三份

`commands/chat.js`、`commands/session.js`、`server/tests/agent-helpers.js` 各有一份装配代码（`getAgent` + `checkPermission` + 取 session/settings/tools 的逻辑）。这是有意为之：把它们抽进 `commands/assemble.js` 会让 commands 之间互相引用，违反分层约束。三份重复比一个违反架构的公共模块更好。

## Agent 循环来自外部包

模型请求、工具执行、上下文压缩由已发布的 `@kernel4632/agent-core` 负责（[仓库](https://github.com/kernel4632/agent-core)），本项目不再自带实现。
升级这个包之前先看它的 README 里「从 X 升级」的说明，升级后在同一个提交里跑一遍后端测试。

**第三方包的 bug 不在本仓库里修**：排查确认根因在 agent-core 或其它第三方包里时，不要擅自改包的代码或打临时补丁；把根因、复现方式和期望行为整理成 issue 报给那个包的仓库，由包作者先修、发新版，再按上面的升级流程更新进来。本仓库侧只做：绕过手段（如果能在自己代码里合理避开）和等新版适配。

内置工具放在 `server/tools/`：一个文件放一个或一组工具，导出的对象里有 `name`、`description`、`inputSchema`、`execute` 就会被扫描到。
加一个工具就放一个文件，删一个工具就删一个文件，不需要在任何中央文件里登记。
