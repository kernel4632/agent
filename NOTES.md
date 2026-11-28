# Agent 设计笔记

> 2026-11-25 按当前代码整理（backend 0.3.0 / web 0.9.0 / agent-core ^1.2.1）。
> 启动、目录、接口见 [README.md](README.md)；接手检查表见 [docs/HOP-AUDIT.md](docs/HOP-AUDIT.md)。

这是一个**通用 Agent 基座**，不是开发者专用的编码工具，也不是把 OpenCode、Roo Code、RikkaHub、Cherry Studio 的功能拼在一起。

它的中心是**会话**。用户打开一个会话，agent 就在这个会话里持续工作；目录只是会话的一个属性，不是项目、工作区或仓库。基座要轻量、开箱即用：

- 代码少，但通用能力不能少。
- 不依赖用户电脑上有没有 git、有没有某个命令行工具。
- MCP、技能、自动标题这些是通用能力，不是开发者附加项。
- 工具自己负责自己的细节：文件快照、敏感文件判断、长文本截断、命令风险，都是工具的事，不是 agent 核心的事。

## 一、与常规 Agent 的区别

| 常规 Agent | 这个 Agent |
| --- | --- |
| 项目/工作区是中心，一个项目一个配置 | 会话是中心，目录只是会话当前的 `cwd` |
| 工作区有边界，工具不能越过 | 没有工作区边界；agent 可以移动到任意目录 |
| 用户切换项目，agent 跟着换上下文 | 会话保留完整历史，换目录不丢上下文 |
| git 是基础能力 | 不依赖 git；需要时让工具自己调用 |
| 规则、忽略文件由 agent 核心统一管 | 工具自己决定能读什么、写什么、备份什么 |
| 子 agent 是独立功能 | 子 agent 是一个工具，本质是特殊会话加特殊提示词 |
| 标题是可选设置 | 自动标题是默认行为，不需要开关 |
| 工具越多越像开发者工具 | 工具按类别分组，普通用户也能直接使用 |

## 二、核心概念

### 1. 会话

会话是唯一的长期容器。一个会话包含：标题、当前目录、模型、历史、设置（思考强度等）。
会话不绑定项目，不绑定 git，不绑定固定目录。

现在的 `meta.json` 只存标题、分组、模型、思考强度、学到的上下文比例和时间；
**cwd 还没按会话保存**：工具继承后端进程的工作目录，这是已知边界（见第九节）。

### 2. 当前目录

当前目录不是"工作区"，只是 agent 认为自己现在站在哪里。改目录不丢历史，也不要求目录里有任何项目文件。
没有工作区边界，不阻止 agent 去别处。当前实现还没把这个位置落进会话数据。

### 3. 运行

一次运行从用户发消息开始，到模型正常收尾、连续 `noToolRounds` 轮（默认 3）不调工具、或用户停止为止。
工具可以返回 `stop: true` 结束整轮（基础工具里的 `finish` 就是这样）。

运行过程通过 SSE 推给界面：模型增量、工具调用、工具输出、审批请求、压缩进度、标题、错误和结束。
同一个会话一次只跑一件事：正在跑时再 send / compact 返回 409。进程重启不自动续跑。

### 4. 工具

工具是 agent 唯一能改变外部世界的方式。工具文件由扩展登记，agent-core 本身不带工具：

- `extensions/tools/tools/`：read_file、write_file、edit_file、list_dir、shell、webfetch、finish
- `extensions/todo/tools/todo.js`：任务清单
- `extensions/skill/tools/skill.js`：按名字读取全局技能

工具自己负责文件快照、敏感文件判断、输出截断、命令风险判断、权限提示和结果渲染模板。

### 5. 扩展

MCP、技能、任务清单、权限、自动标题都是**内置扩展**，不是核心的一部分。扩展可以：

- 包宿主的方法（`ctx.patch`），后加载的在外层，拔出时逆序撤销。
- 登记工具（`ctx.tool`）、动作（`ctx.op`）、跨扩展接口（`ctx.expose` / `ctx.use`）。
- 往界面登记整页、顶栏按钮、对话侧栏、浮层，或替换某个组件。

## 三、不做什么

- 不做 git 状态、git 提交、项目仓库概念。
- 不做 workspace CRUD、工作区边界、跨工作区绑定。
- 不做 `.agentignore`、全局敏感文件名单；工具自己判断。
- 不做项目规则 `rules`；通用用户不一定有项目。
- 不做斜杠命令；普通用户不常用。
- 不把文件快照做成核心功能；它是工具的内部实现。
- 不把消息回退和文件恢复混在一起；消息回退只动历史。
- 不把上下文构建和上下文压缩混成一个文件（都在 agent-core 里）。
- 不在项目里放 `skills/`；技能是用户全局数据和项目数据。
- 不做流程编排、子 agent、桌面端；需要时用扩展加入，不改 core 的循环。

## 四、现在的代码结构

```text
backend/
  server.js                路由表 + 启动，路由只在这里写一次
  features/                主体，平铺
    Agents.js              打开、发送、停止、压缩、截断、换模型
    Stream.js              SSE 订阅、尾巴合并、run / cut 分发
    Store.js               AGENT_HOME 里的配置、meta、history 读写
    Models.js              供应商/模型 → agent-core 连接参数
    Extension.js           patch 链、ctx.tool / op / expose / use
    Loader.js              扫描、拓扑、启停扩展
    Bundle.js              扩展前端打包（Bun.build + Vue SFC）
  tests/                   mock 测试

web/src/
  main.ts                  组件表 → 连推送 → 加载扩展 → 挂 App
  api.ts                   唯一请求出口；connect 走 SSE
  Agent.ts                 历史只跟 core 的 message，实时状态跟事件
  Extension.ts             组件表、patch、扩展前端加载
  App.vue                  对话流 + 输入区（没有顶栏）
  components/              History、Composer、Stats、ToolCall…

extensions/<name>/         manifest.json、backend.js、可选 frontend/
```

导入只往下走：`server.js → Agents / Stream / Loader → Extension / Models → Store → agent-core`。同层不互相 import。

## 五、数据形状

数据目录是 `AGENT_HOME`，默认 `~/.agent`：

```text
~/.agent/
  config.json                 整份替换
  agents/<id>/meta.json       标题、分组、模型、思考强度、学到的比例、更新时间
  agents/<id>/history.jsonl   一行一条 core 消息；只有截断时整份重写
```

`config.json` 认得这些字段：

```json
{
  "providers": [
    {
      "name": "relay",
      "baseURL": "https://example.com/v1",
      "apiKey": "sk-...",
      "protocol": "chat",
      "models": [{ "id": "glm-latest", "name": "GLM", "context": 128000 }]
    }
  ],
  "models": { "chat": "relay/glm-latest", "compact": "" },
  "mcp": [{ "name": "context7", "url": "https://mcp.context7.com/mcp", "transport": "http", "enabled": true }],
  "permission": { "*": "ask", "read_file": "allow" },
  "compactThreshold": 0.95,
  "extensions": { "disabled": [] },
  "skills": { "disabled": [] }
}
```

- 模型 id 对外统一是 `供应商名/模型 id`；某一档思考强度的参数原样合进 core 的 config，代码不认识任何一家供应商。
- 模型条目可写 `"textTools": true`（界面里是模型卡片上的「模拟工具」开关）：给没有原生 tool_calls 解析的模型用，工具说明写进提示词、调用从回复文本解析；core 刻意不做自动降级，同一个模型开不开互不影响。
- `mcp` 只支持 `http` / `sse`；没有 `url` 的 stdio 条目新 core 接不了。
- 权限规则按工具名匹配，值是 `allow` / `deny` / `ask`，也可以是一张"参数模式 → 动作"表。

一条历史就是一条 core 消息，例如：

```json
{"role":"user","content":"你好","id":"XvpJwjnUI81x6Qlns5-ZZ"}
{"role":"assistant","content":[{"type":"text","text":"你好"}],"request":{"model":"glm-latest","start":1795269995517,"duration":12,"usage":{"input":100,"output":5,"cacheRead":0,"cacheWrite":0}},"id":"1hEVT8-Fs-atIgiq5-xoH"}
```

## 六、一次请求怎么走

```text
浏览器  --POST /api/agent/:id/send-->  Agents.send
                                      agent-core 跑循环、写历史、发事件
浏览器  <--GET  /api/agent/:id/stream--  先 snapshot，再 core / run / cut / 扩展事件
```

- 连上（含断线重连）先发 `snapshot`：完整历史、进行中的尾巴、运行状态、重试时间、模型列表。
- `core` 是 agent-core 的原样事件；`run` 是整轮开始/结束；`cut` 是宿主截断了历史。
- 历史上只有 core 的 `message` 事件会落盘并显示；用户消息也等 core 收下才出现。
- 尾巴只合并"最近一次写进历史之后"的片段，刷新时喂给前端已有的 receive 即可。

## 七、扩展

`manifest.json`：

```json
{ "name": "todo", "version": "0.1.0", "base": 1, "requires": ["shell"], "after": ["tools"], "description": "…" }
```

- `base` 是扩展协议版本，目前是 1，对不上就不启动。
- `requires` 是硬边，缺依赖或上游没启动自己也不启动；`after` 是软边。
- `backend.js` 默认导出 `ctx => { … }`；`frontend/index.js` 默认导出 `app => { … }`。
- 前端由后端打包，`vue` 留成外部引用，页面从 `globalThis.__agentVue__` 取；改 `.vue` 会按 mtime 重打。
- 类型：JS 写扩展也全程有编辑器推导——前端 `/** @param {import('agent-extension').App} app */`（形状在 `web/src/types.ts`），后端 `/** @param {import('agent-backend').Ctx} ctx */`（形状在 `backend/extension.d.ts`）；两份声明与实现同步维护，检查命令在第八节。
- 调试前端组件不用等后端打包：vite dev 下把地址开成 `?ext=<名字>,<名字>`，列出的扩展直接从源码加载（HMR、Volar 全可用）；后端照常跑，只是这些扩展的前端不走打包产物。

内置九个：

| 扩展 | 后端 | 前端 | 负责 |
| --- | --- | --- | --- |
| `shell` | 无 | Chrome / Bar / Chat | 唯一界面壳：顶栏标签、对话顶栏、整页容器 |
| `session` | 会话列表、增删改名 op | Home | 主页会话列表；打开的会话进顶栏标签 |
| `settings` | 无 | Page / Providers / Form | 整页设置：供应商、默认模型、扩展开关 |
| `tools` | 登记 7 个工具 | ShellView / FileView | 读改写文件、列目录、命令、抓网页、finish |
| `permission` | patch callbacks 加审批 | Ask / Rules | allow / deny / ask 规则和询问浮层 |
| `skill` | 扫描技能目录、注入清单 | Panel | 技能开关和查看 |
| `todo` | 工具 + todo.list / update | Panel | 任务清单，从对话顶栏打开 |
| `mcp` | mcp.list / save / open / close | Panel | MCP 服务的增删和开关 |
| `title` | patch callbacks 改标题 | 无 | 第一条用户消息截成标题 |

业务代码用 `ctx.patch` / `ctx.tool` / `ctx.op` 和 `app.shell` / `app.settings` / `app.toolViews`。

## 八、验证

```sh
cd backend && bun run test   # mock 测试 + 扩展后端 checkJs（tsc -p tsconfig.extensions.json）
cd web && bun run check && bun test && bun run build   # 本体 vue-tsc + 扩展前端 checkJs + 前端纯逻辑单测
```

需要 Bun ≥ 1.4.4（测试夹具用了 `ReadableStream.from`）。新加接口或改行为时，在同一次提交里补测试。改 `App` / `Ctx` 的形状时同步改 `web/src/types.ts` / `backend/extension.d.ts`。

## 九、已知边界

- `snapshot` 一次发完整历史，没有分页/虚拟滚动；很长的会话打开会很慢（实测 1.6 万条消息 ≈ 51MB，读取约 20 秒）。
- cwd 还没按会话保存，工具继承后端进程的工作目录。
- MCP 只支持 http / sse；stdio 形式的 MCP 新 core 接不了。
- 服务端没有登录鉴权；部署时让前后端同源或走反向代理，并关闭 SSE 缓冲。
- 桌面端没开始；git、项目规则、斜杠命令、子 agent、流程编排都不做。
- agent-core 只从 npm 装（`^1.2.1`）；要改 core 先在 agent-core 仓库发版，不要提交 `file:` 本地路径。

## 十、不做兼容

正式版发布之前，只认当前的数据形状和接口，不写字段迁移、旧会话兼容或旧接口层。开发机上的 `~/.agent` 可以直接删掉重建；测试和文档也不写"旧版本会怎样"的用例。
