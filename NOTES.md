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
- 设置：自动批准、思考强度、模型切换等。

会话不绑定项目，不绑定 git，不绑定固定目录。

### 2. 当前目录

当前目录不是“工作区”，只是 agent 认为自己现在站在哪里。

- 用户可以在界面上改。
- agent 可以用 `cwd` 工具自己改。
- 改目录不丢历史，也不要求目录里有任何项目文件。
- 没有工作区边界，不阻止 agent 去别处。

### 3. 运行

一次运行从用户发消息开始，到 agent 结束或用户停止为止。

运行过程通过 SSE 推给界面：模型增量、工具调用、工具输出、审批请求、压缩进度、标题、结束。

### 4. 工具

工具是 agent 唯一能改变外部世界的方式。工具按类别放文件，不按单个动作拆文件：

- `tools/file.js`：读、写、列目录、编辑、补丁，以及文件自己的快照和恢复。
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

- MCP：在配置里添加服务，工具清单自动多出外部工具。
- 技能：从用户全局目录 `~/.agents/skills` 和项目里的`.agent/skills`读取 Markdown，工具按需读取正文。
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
  server.js              入口：注册路由、统一错误、启动；健康检查也在这里
  store.js               全局数据中心：纯对象，直接看到 config 和 sessions
  package.json
  openapi.json
  README.md
  .gitignore
  bun.lock

  commands/              入口指令：一个文件对应一组 HTTP 动作
    session.js           会话创建、列表、读取、分支、改名、删除、目录、设置、模型
    chat.js              发送、继续、停止、审批决定
    config.js            配置 HTTP 动作：读取、保存、连接测试
    tool.js              工具目录和权限

  features/              可复用业务规则
    config.js            配置读取、旧字段迁移、保存
    history.js           消息历史、元数据、读取
    rollback.js          消息回退和撤销；不碰文件
    agent.js             创建 Agent、准备系统提示词和工具表
    run.js               发送、继续、停止、运行收尾
    approval.js          工具审批：允许、询问、拒绝、等待用户
    context.js           构建模型上下文
    compact.js           上下文压缩
    title.js             自动标题
    tool.js              工具登记、扫描、类别、文件参数
    mcp.js               MCP 服务连接

  utils/                 通用小工具
    fail.js              带状态码的错误
    path.js              ~/.agents 数据路径
    sse.js               实时事件连接

  tools/                 按类别分组，一个文件放一组工具
    file.js              文件与目录：读、写、列表、编辑、补丁、快照
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

    // 不同任务可以分别指定默认模型；不填就回退到 chat。
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
    //     autoApprove: {},
    //     autoApproveLimit: 50,
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

## 七、验证底线

- 不装 git、不在 git 仓库里，也能创建会话、读写文件、改目录、使用 MCP 和技能。
- 用户不会看到“工作区”“仓库”“分支”“忽略规则”这些开发者概念。
- 每个工具文件只做一类动作；增删一类工具只动一个文件。
- 每个 feature 文件有明确职责；消息回退、上下文构建、上下文压缩、文件快照不混在一起。
- `store.js` 只看数据就能知道全局配置和会话长什么样。
- 所有对用户电脑外部工具的依赖，都在工具自己的实现里，不在 agent 核心。

## 八、依赖方向

四个目录保留，不重排；依赖只允许朝一个方向走：

```text
commands/ → features/ → tools/
      ↘          ↓         ↙
        store.js + utils/
```

- `tools/` 只 import `store.js` 和 `utils/`。需要审批、保存会话时，由工具宿主通过运行时 context 传进来，工具不反向 import `features/`。
- 只有 `features/tool.js` 这个工具宿主可以组装 `tools/file.js`、`tools/skill.js`、`tools/subagent.js`；其他 feature 不碰工具实现。
- `store.js` 和 `utils/` 是叶子，不 import 上层。

为了做到这一点：

| 改动 | 原因 |
| --- | --- |
| 新增 `features/config.js`，接手配置读取、旧字段迁移和保存；`Agent.saveConfig` 搬过去 | `approval.js` 不再 import `agent.js`，打断 approval ↔ agent |
| `tools/subagent.js` 的审批从 `context.onPermission` 拿 | 去掉 tool → feature 的反向边 |
| `tools/cwd.js` 的保存从 `context.saveSession` 拿 | 去掉 tool → feature 的反向边 |
| `features/agent.js` 把 `onPermission` 和 `saveSession` 传进 `Tool.build` | 工具宿主把运行时能力注入工具 |
| `commands/config.js` 只留 HTTP 动作 | 入口层不放迁移逻辑 |

结果：27 → 28 个文件，依赖边 73 → 71；循环依赖 1 → 0，工具反向依赖 2 → 0。少掉的 2 条来自配置读写集中后不再需要的入口边，以及 agent 不再需要的 `utils/path`。`features/tool.js` 对三个特殊工具的组装是唯一有意的 features → tools 边。

这是内部重构，HTTP 接口、字段和配置形状都不变。完整图见 `docs/server-target.html`。
