# Agent 设计笔记

> 这是目标设计；后端 `server/` 已经按这份笔记迁移。

这是一个**通用 Agent 基座**，不是开发者专用的编码工具，也不是把 OpenCode、Roo Code、RikkaHub、Cherry Studio 的功能拼在一起。

它的中心是**会话**。用户打开一个会话，agent 就在这个会话里持续工作；当前目录只是会话的一个属性，不是项目、工作区或仓库。用户可以让 agent 去某个文件夹，agent 也可以自己移动过去。目录可以随时换，不需要新建项目，不需要 git，不需要理解“工作区”这个概念。

基座要轻量、开箱即用：

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

## 二、五个核心概念

### 1. 会话

会话是唯一的长期容器。一个会话包含：

- 标题：自动生成，不提供“是否自动标题”的开关。
- 当前目录 `cwd`：用户和 agent 都可以改。
- 模型：这个会话当前使用的模型。
- 历史：消息、工具调用、回退栈。
- 设置：思考强度、模型切换等。

会话不绑定项目，不绑定 git，不绑定固定目录。

### 2. 当前目录

当前目录不是“工作区”，只是 agent 认为自己现在站在哪里。

- 用户可以在界面上改。
- agent 可以用 `cwd` 工具自己改。
- 改目录不丢历史，也不要求目录里有任何项目文件。
- 没有工作区边界，不阻止 agent 去别处。

### 3. 运行

一次运行从用户发消息开始，到 agent 结束或用户停止为止。模型没有调用任何工具时会再追问，最多 3 轮；默认提示词要求用 `attempt_completion` 收尾，追问时会再提醒一次。

运行过程通过 SSE 推给界面：模型增量、工具调用、工具输出、审批请求、压缩进度、标题、结束。

### 4. 工具

工具是 agent 唯一能改变外部世界的方式。工具按类别放文件，不按单个动作拆文件：

- `tools/file.js`：读、写、查找文件、搜索内容、编辑（单文件或批量），以及文件自己的快照和恢复。
- `tools/web.js`：内置的网络搜索工具，通过特殊方法实现搜索功能和网页信息获取功能。
- `tools/shell.js`：执行命令相关的工具，异步执行、读取执行输出等。
- `tools/todo.js`：维护任务清单。
- `tools/control.js`：完成、询问用户。
- `tools/subagent.js`：子智能体，启动一个直接复用项目agent功能的子agent，具有自己的系统提示词。
- `tools/cwd.js`：移动agent自己的位置到新目录。
- `tools/skill.js`：列出和读取全局技能。

工具自己负责：

- 文件快照和恢复。
- 敏感文件判断。
- 输出截断。
- 命令风险判断。
- 工具自己的权限提示。
- 工具自己的调用渲染与输出内容的渲染模版结构与样式

agent 核心不替工具做这些判断。

### 5. 扩展

MCP、技能、子任务都是基座能力，不是后续插件市场的概念。

- MCP：在配置里添加服务，工具清单自动多出外部工具；设置页可以识别本机其他软件留下的 MCP 配置，确认后导入。
- 技能：从用户全局目录 `~/.agents/skills`、项目里的 `.agent/skills` 和用户启用的外部目录读取 Markdown，工具按需读取正文；启用状态保存在数据目录的 `skills.json`。
- 能力管理：MCP 和技能都能在设置页增删改、启停；识别是只读的，不会改其他软件的文件。
- 子任务：`tools/task.js` 启动一个特殊会话，使用自己的提示词和上下文，把结论交回主会话。
- 自动标题：每次会话第一次产生助手回复后自动生成，失败就保留默认标题（用户发送第一条消息的前几个字），自动标题可以用户操作按照后续的对话内容重新生成。

## 三、不做什么

- 不做 git 状态、git 提交、项目仓库概念。
- 不做 workspace CRUD、工作区边界、跨工作区绑定。
- 不做 `.agentignore`、全局敏感文件名单；工具自己判断。
- 不做项目规则 `rules`；通用用户不一定有项目。
- 不做斜杠命令；普通用户不常用。
- 不做独立的健康检查文件；一行路由写在 `server.js`。
- 不把文件快照做成核心功能；它是文件工具的内部实现。
- 不把消息回退和文件恢复混在一起；消息回退是独立功能。
- 不把上下文构建和上下文压缩混成一个文件。
- 不在项目里放 `skills/`；技能是用户全局数据和项目数据。
- 不内置诊断命令、长文本截断、工作区规则这类开发者专属能力。

## 四、目录结构

```text
server/
  server.js              入口：装配有状态模块、注册路由、统一错误、启动；健康检查也在这里
  store.js               全局数据中心：纯对象，直接看到 config 和 sessions
  package.json
  README.md
  .gitignore
  bun.lock

  commands/              入口指令：一个文件对应一组 HTTP 动作，命令之间不互相 import
    session.js           会话创建、列表、读取、分支、改名、删除、目录、设置、模型
    chat.js              发送、继续、停止、审批决定；一次运行的编排也在这里
    settings.js          配置读写、模型测试、工具目录

  features/              独立模块：文件之间不互相 import
    config.js            配置读取、旧字段迁移、保存
    history.js           消息历史、元数据、读取
    rollback.js          消息回退和撤销；不碰文件
    agent.js             有状态：创建 Agent；审批、工具、历史由 server.js 注入
    approval.js          有状态：工具审批；工具查询和配置保存由 server.js 注入
    context.js           构建模型上下文
    compact.js           纯逻辑：接收 agent 和消息，返回压缩结果
    title.js             自动标题
    tool.js              有状态：工具登记、扫描、类别；MCP 由 server.js 注入
    mcp.js               MCP 服务连接

  utils/                 通用小工具
    fail.js              带状态码的错误
    path.js              ~/.agents 数据路径
    sse.js               实时事件连接

  tools/                 按类别分组，一个文件放一组工具
    file.js              文件与目录：读写、查找文件、搜索内容、编辑、快照
    shell.js             执行命令
    web.js               网页抓取
    todo.js              任务清单
    control.js           完成任务、询问用户
    subagent.js          子智能体
    cwd.js               移动当前目录
    skill.js             列出和读取全局技能

  tests/
```

根目录只有入口、数据、项目配置和 `commands/`、`features/`、`utils/`、`tools/`。没有 `workspace/`、`agent/`、`conversation/`、`safety/`、`state/`、`project/`、`skills/`、`tool-registry/` 这些多余层。

## 五、`store.js` 的数据形状

`store.js` 只放可序列化的数据。运行中的 Agent 实例和等待审批的 `resolve` 函数不在这里。

```js
const store = {
  config: {
    providers: [
      // {
      //   name: 'local',
      //   baseURL: 'http://127.0.0.1:11434/v1',
      //   apiKey: '',
      //   models: [
      //     {
      //       id: 'qwen3',
      //       name: 'Qwen3',
      //       context: 128000,
      //       capabilities: ['text', 'tools', 'image'],
      //     },
      //   ],
      // },
    ],

    // 不同任务可以分别指定默认模型；不填就回退到会话自己的模型（新会话默认取 chat）。
    models: {
      chat: { provider: '', model: '' },
      compact: { provider: '', model: '' },
      title: { provider: '', model: '' },
      task: { provider: '', model: '' },
    },

    mcp: {},
    permission: {},
    prompt: { system: '', seeded: false },
    compact: { threshold: 0.8 },
  },

  sessions: {
    // [id]: {
    //   id: 'session-id',
    //   title: '新对话',
    //   cwd: 'D:/notes',
    //   model: { provider: 'local', model: 'qwen3' },
    //   createdAt: 0,
    //   updatedAt: 0,
    //   history: { messages: [], redo: [] },
    //   settings: {
    //     reasoning: 'auto',
    //   },
    // },
  },
}

export default store
```

关键点：

- `providers[].models[]` 里的每个模型自己带 `capabilities` 和 `context`，不再有全局 `capabilities`。
- `config.models` 是不同任务的默认模型，解决“压缩、标题、子任务分别用哪个模型”。
- `title` 没有开关；自动标题是默认行为。
- `mcp` 是配置的一部分，属于基座能力。
- `sessions[].cwd` 是唯一的位置概念，没有 `workspaceId`。
- `history` 和 `settings` 属于会话；消息回退只改 `history`，不碰文件。
- 权限只有一层：`config.permission` 的全局规则（allow / ask / deny、参数模式）加每次询问的 allow / deny（弹窗只管这一次，长期规则在「工具自动批准」里设）。没有会话级 `autoApprove`。对象规则里的 `*` 是该工具的默认动作；其余模式按参数匹配，`*` 跨过斜杠和换行。规则已经是 allow 就直接放行。输入区「工具自动批准」小窗里的全选格子只把全局 `*` 写成 allow 来一次全开，不改每个工具已经记住的规则。全局 allow 盖过工具默认的 ask，多行命令也不会因为前缀没对上再弹批准；明确的 deny 仍然拒绝。全不选要把每个工具的默认动作写回 ask 才会真的全灭（只改全局，之前记住的 allow 会让开关继续亮着）；单关一个工具时先把它以外的工具此刻的状态写实，再撤全局，否则它们会跟着一起掉回询问。

## 六、请求流程

```text
HTTP/SSE
  → server.js
  → commands/*
  → features/*
  → agent-core
  → tools/*
  → SSE / 返回值
```

### SSE 连接

`utils/sse.js` 自己管理 `ReadableStream`，不依赖第三方 SSE 适配器的延迟初始化。

- 初始化前被客户端取消、被新连接替换、或 `SSE.close()` 关闭时，只关闭自己这一条流，不再向已关闭的流写入。
- 每个会话缓存还没落盘的事件，新连接建立后补发；心跳 15 秒。
- 连接的身份要检查，旧连接的清理不能覆盖新连接。

## 七、验证底线

- 不装 git、不在 git 仓库里，也能创建会话、读写文件、改目录、使用 MCP 和技能。
- 用户不会看到“工作区”“仓库”“分支”“忽略规则”这些开发者概念。
- 每个工具文件只做一类动作；增删一类工具只动一个文件。
- 每个 feature 文件有明确职责；消息回退、上下文构建、上下文压缩、文件快照不混在一起。
- `store.js` 只看数据就能知道全局配置和会话长什么样。
- 所有对用户电脑外部工具的依赖，都在工具自己的实现里，不在 agent 核心。

## 八、模块边界

四个目录保留，不重排。规则只有三条：

- `features/` 的文件之间不允许互相 import。每个文件只做自己的功能，需要别的模块时从参数或 `server.js` 启动时的 `bind` 注入。
- `commands/` 的文件之间不允许互相 import。它们只 import `features/`，把功能编排成指令。
- `server.js` import `commands/` 和工具需要的 feature，装配有状态模块；一个指令对应一个 API。

依赖方向：

```text
server.js
  → commands/
      → features/
          → store.js + utils/
      → store.js + utils/
```

`tools/` 只依赖 `store.js`、`utils/` 和运行时 context，不 import `features/`。

### features 里允许的三种文件

- **纯逻辑**：`compact`、`rollback`、`context`、`title`。传入数据，返回结果，不自己读写会话。
- **独立适配器**：`history`、`config`、`mcp`。只碰 `store.js`、`utils/` 或外部服务，不 import 别的 feature。
- **有状态服务**：`agent`、`approval`、`tool`。自己保存运行中的 agent、待审批和工具缓存；需要别的 feature 时由 `server.js` 在启动时 `bind` 进来，文件本身不 import 兄弟。

`features/run.js` 只被 `commands/chat.js` 使用，直接并进 `chat.js`。features 里不再有运行编排。

### 具体改动

| 文件 | 怎么改 |
| --- | --- |
| `features/agent.js` | 去掉对 approval/context/history/tool 的 import；加 `bind`，由 `server.js` 注入这四项服务 |
| `features/approval.js` | 去掉 tool/config import；加 `bind`，由 `server.js` 注入工具查询和配置保存 |
| `features/tool.js` | 去掉 mcp import；加 `bind`，由 `server.js` 注入 MCP |
| `features/compact.js` | 改成 `run({ agent, onEvent }) -> summary`，不碰 history/sse |
| `features/rollback.js` | 改成接收 `history` 和 `agent` 参数，不 import 它们 |
| `features/config.js` / `context.js` | 默认提示词挪到 `store.js`，去掉 config → context |
| `commands/chat.js` | 接手 `features/run.js` 的发送/继续/停止逻辑 |
| `commands/session.js` | 压缩、回退按新签名调用 |
| `commands/settings.js` | 合并原 `commands/config.js` 和 `commands/tool.js`：配置读写、模型测试、工具目录 |
| `commands/config.js` / `commands/tool.js` | 删除；`tool.js` 只是把 `Tool.list()` 原样转出去，没有做决定 |
| `features/run.js` | 删除 |

结果：源码文件 27 → 26，命令文件 4 → 3；`features/` 内部 0 条边，`commands/` 内部 0 条边。HTTP 路径、字段、状态码不变。

### 小文件判断

一个文件值不值得存在，不看行数，看它有没有做决定、有没有自己的数据、是不是多个模块共用的契约。

- `commands/tool.js` 只是转手，删掉。
- `utils/fail.js` 被 commands、features、tools 二十多处共用，保留；文件头压短，不为凑行数硬加函数。
- 纯逻辑文件即使很短，只要它是一个完整功能（比如 `compact`），就保留。

这是内部重构，图按需从当前源码生成到 `tmp/`，不再在 `docs/` 里留淡话。

## 九、发布前不写向后兼容

正式版发布之前，代码只认最新版本的数据形状。旧版本没有用户，也没有需要保留的数据。

- 不写旧字段迁移：没有 `modelSettings`、全局 `model`、`uses`、`compactThreshold` 这些别名。
- 不写旧会话兼容：`meta.json` 只认 `model: { provider, model }`，不再认 `provider` 字符串加 `model` 字符串。
- 不写旧文件兼容：`history.json` 必须有 `messages` 和 `redo`；`checkpoints.json` 必须有 `redone`。
- 不写旧设置兼容：`settings.json` 只有 `reasoning`；旧 `autoApprove` 等字段直接不读。
- 不写旧接口兼容：前端只对接当前后端，`/workspace/*`、`/agent/list`、`/command/list` 不再提供。

旧数据不迁移。开发机上的 `~/.agent` 可以直接删掉重建；测试和文档也不写“旧版本会怎样”的用例。发布正式版之后再按版本号做迁移，那时才需要兼容。

## 十、前端组件自有化

前端不再依赖 KIMA、M3E 的 UI 组件和主题系统。现有界面外观与交互由项目自己的 Vue 组件和原生 HTML 控件实现；迁移期间不保留旧组件名的兼容层。

- 业务组件按可见区域归类在 `frontend/src/components/`；可复用基础控件放 `frontend/src/ui/`，由调用者直接导入 Vue 文件。
- `frontend/src/styles/` 保存所有 Vue 组件样式，并镜像 `src/` 下的目录结构。每个 `.vue` 组件对应一个同名 `.scss` 文件；Vue 文件只保留模板、事件和必要的临时逻辑，通过外部 `<style src>` 关联 SCSS。
- `base.scss`、`tokens.scss` 保留为全局基础样式和设计变量；组件专属规则只放对应的 SCSS，不在 Vue 文件或全局样式里重复定义。
- 保留现有功能、可访问性、主题切换和视觉反馈；先记录界面行为，再以浏览器检查确认迁移前后主要流程一致。
- 删除 KIMA、M3E 的运行时、主题同步代码和依赖；图标资源可继续使用 Hugeicons，因为它只提供图形，不承担控件外观或交互。
- 完成后运行 `bun run build`、`bun run test` 和 `bun run test:ui`，并确认源码不再引用 KIMA/M3E。

## 十一、前端组织：功能主体与视觉组件分开

功能平铺到 `commands/`，页面与视觉区域分属 `views/` 和 `components/`。当前目录与使用方式以 `frontend/README.md` 为准，完成计划和过期图表不作为接手依据。

- 前端功能主体统一平铺在 `src/commands/`，例如会话、聊天、历史、设置、供应商。一个功能主体的读写、校验和操作集中在自己的文件中；不再增加 `features/` 这一层。
- `store.js` 只是共享数据定义，HTTP/SSE/剪贴板等放 `utils/`。它们不是功能主体，不为凑目录把它们塞进 `commands/`。
- 组件不是功能主体。`views/` 组装页面，`components/` 放可见区域，`ui/` 放重复使用的基础控件。组件拆分依据是独立修改边界、视觉整体和父子层级。
- 一起改、共享同一份临时状态、缺少独立视觉边界的内容可以合并。统计面板、模型选择器、供应商编辑器等独立区域应保留；不把所有设置或工具结果塞进一个大组件。
- 修改频率要结合提交记录和实际改动判断；没有记录时只标注预期的独立变化，不能把猜测写成统计结果。
- 页面或独立容器负责接通 commands；展示子组件只接收数据和发出明确事件。commands 不导入 Vue 组件，不靠全局事件总线回调页面。
- 样式继续集中在 `styles/`，对应组件样式与公共变量分开。功能边界的调整不自动推翻“Vue 不内嵌样式正文”的已有要求。
- 不设置总文件数和单文件体积的硬指标；组件目录按下节约定分组。

聊天空状态与已有会话共用 ChatView；模型选择、统计、设置编辑保留各自的视觉边界。共用交互集中在 Button、Field、Dialog、Menu、Markdown。运行中有引用的标签操作和文案模块按真实使用保留。

导入方向、零循环、Vue/SCSS 配对和组件分组由测试检查。修改后跑前端逻辑测试、相关桌面/移动端检查及构建；接口测试读取 `frontend/src/utils/api.js`。

## 十二、前端目录精简约定

- 删除 `src/assets/` 和模型品牌识别代码，模型入口统一使用现有通用模型图标。
- 删除 `components/results/` 中按工具类型维护的专用视图。`ToolResult.vue` 统一呈现输入参数、返回文本或 JSON、执行状态和已有动作；增加工具不再增加前端渲染器，也不把这些分支搬进一个大文件。
- `components/` 按导航、输入、对话、运行信息、反馈、偏好设置、供应商设置、能力设置归类，每组 2～5 个 Vue 文件；对应 SCSS 同步迁移。分组用于浏览同类可见区域，不分拆 commands 功能主体。
- `views/`、`ui/` 只保留 Vue 组件。页面装配表并回页面，控件出口改成显式导入；删除随品牌图标取消的 JS 和无调用者的头像工具。功能操作归 commands，通用传输和浏览器能力继续归 utils。
- 删除 `frontend/docs/` 的过期接口副本和完成计划；保留精简的当前 README，接口以 `server/README.md`、`server/server.js`、`src/utils/api.js` 为准。完成计划不再长期留在源码旁。
- 根目录 `docs/frontend-*` 是已完成设计和旧结构的快照，一并清理；需要可视化时从当前源码生成到 `tmp/`，避免留下第二份过期说明。

## 十三、前端与当前后端保持一致

- 会话列表直接读取 `/session/list`，目录只使用会话的 `cwd`；不再请求已删除的 `/workspace/read`、`/agent/list`、`/command/list`。
- 配置按当前 `providers[].models[]`、`models.{chat,compact,title,task}`、`compact.threshold` 读写；会话设置只有 `reasoning`。模型能力用英文标识保存、中文标签显示。
- 不展示后端已经移除的智能体编辑、斜杠命令、全局能力和高级设置；不增加旧接口兼容层。
- `bun run test:live` 启动真实前后端验证读写，只有模型服务使用本机固定回复；模拟界面测试同时检查 server.js 注册的路由，不能用过期 mock 代替联调结果。
