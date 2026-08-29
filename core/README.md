# @kernel4632/agent-core

一个轻量的 AI Agent 核心包。给它一个 LLM 地址和一堆工具文件，它就能自动循环"问模型 → 执行工具 → 再问模型"，直到任务完成。

---

## 目录

- [这个包是干什么的](#这个包是干什么的)
- [安装](#安装)
- [5 分钟快速上手](#5-分钟快速上手)
- [项目架构](#项目架构)
- [自定义工具：从零到完整](#自定义工具从零到完整)
- [API 参考](#api-参考)
- [运行测试](#运行测试)
- [常见问题](#常见问题)

---

## 这个包是干什么的

你可以把它理解成一个"AI 大脑驱动引擎"：

```
你的程序
  └─ Agent.create()      ← 创建一个 AI 实例
       └─ agent.send()   ← 发送任务指令
            └─ Loop      ← 自动循环
                 ├─ LLM  ← 问模型："下一步做什么？"
                 ├─ Tool ← 执行模型要求的工具
                 └─ 把工具结果告诉模型，继续循环
```

模型每次回复要么"调用某个工具"，要么"我做完了"。这个包负责把这个循环跑起来，你只需要写工具文件就行。

---

## 安装

这个包需要 [Bun](https://bun.sh) 运行时（不支持 Node.js）。

```bash
bun add @kernel4632/agent-core
```

---

## 5 分钟快速上手

### 第一步：写一个工具文件

新建 `tools/say-hello.js`：

```js
export default {
    name: 'say_hello',                         // 工具名，模型通过这个名字调用它
    description: '向指定的人打招呼',             // 告诉模型这个工具是干什么的
    inputSchema: {                             // 描述模型需要传哪些参数
        type: 'object',
        properties: {
            name: { type: 'string', description: '要打招呼的人的名字' },
        },
        required: ['name'],
    },
    async execute(input) {                     // 真正执行的函数，input 就是模型传来的参数
        return `你好，${input.name}！`          // 返回值会原样告诉模型
    },
}
```

### 第二步：创建 Agent 并发送指令

新建 `main.js`：

```js
import Agent from '@kernel4632/agent-core'

// 扫描工具目录，得到工具描述和执行器
const tools = await Agent.tool.scan('./tools')

// 创建一个 Agent 实例
const agent = Agent.create({
    config: {
        baseURL: 'https://你的模型地址/v1',    // OpenAI 兼容接口地址
        apiKey: 'sk-你的密钥',
        model: '模型名称',
        system: '你是一个助手，请使用工具完成用户的任务。',
    },
    tools,                                    // 把扫描好的工具传进来
    callbacks: {
        onToolResult: result => {             // 工具执行完时的回调
            console.log('工具执行完了:', result.toolName, result.output)
        },
    },
})

// 发送指令，等待完成
const result = await agent.send({ input: '帮我向小明打个招呼' })
console.log('Agent 结束，原因:', result.reason)   // 'no-tool' 表示模型认为任务完成
```

运行：

```bash
bun main.js
```

---

## 项目架构

```
@kernel4632/agent-core
│
├── index.js              ← 入口，只导出 Agent
├── agent.js              ← Agent.create() 的实现
│
├── features/             ← 功能模块（每个只做一件事）
│   ├── loop.js           ← 主循环：LLM → 工具 → LLM → ...
│   ├── tool.js           ← 工具扫描 + 工具执行
│   ├── context.js        ← 把历史消息裁剪成模型上下文
│   └── compact.js        ← 上下文太长时自动压缩总结
│
└── utils/               ← 基础工具
    ├── llm.js            ← 底层 LLM 请求（支持多种协议）
    ├── history.js        ← 创建标准格式的历史消息块
    ├── retry.js          ← 失败自动重试（指数退避）
    └── tool-worker.js    ← 工具在隔离 Worker 里运行的代码
```

### 数据流

```
agent.send(input)
  │
  ├─ History.user()          把用户输入变成历史块，存入 history 数组
  │
  └─ Loop.run()
       │
       ├─ Context.build()    从 history 裁剪出模型能看的上下文（自动处理 token）
       ├─ LLM.chat()         请求模型（支持流式，失败自动重试）
       │
       ├─ [有工具调用]
       │    ├─ Tool.execute() 在独立 Worker 里并行执行所有工具
       │    └─ 把工具结果写入 history，继续下一轮循环
       │
       └─ [没有工具调用]
            └─ 连续 3 轮无工具则返回 { reason: 'no-tool' }
```

---

## 自定义工具：从零到完整

### 最简单的工具

```js
// tools/add.js
export default {
    name: 'add',
    description: '把两个数字加在一起',
    inputSchema: {
        type: 'object',
        properties: {
            a: { type: 'number' },
            b: { type: 'number' },
        },
        required: ['a', 'b'],
    },
    async execute(input) {
        return input.a + input.b    // 直接返回结果
    },
}
```

### 带流式输出的工具

工具可以用 `yield` 逐步返回内容，适合耗时较长的操作：

```js
// tools/count.js
export default {
    name: 'count',
    description: '从 1 数到 n，逐步输出',
    inputSchema: {
        type: 'object',
        properties: { n: { type: 'number' } },
        required: ['n'],
    },
    async *execute(input) {               // 注意：async * 是异步生成器
        for (let i = 1; i <= input.n; i++) {
            yield `数到了 ${i}`           // 每次 yield 都会立刻发给上层的 onOutput 回调
            await new Promise(r => setTimeout(r, 100))
        }
    },
}
```

接收流式输出：

```js
const agent = Agent.create({
    // ...
    callbacks: {
        onToolOutput: output => {
            console.log('实时输出:', output.data)   // 每次 yield 触发一次
        },
    },
})
```

### 调用子进程的工具

工具在 Worker 里运行，`Bun.spawn` 的 stdout/stderr 会自动转发给 `onToolOutput`，不需要额外处理：

```js
// tools/run-script.js
export default {
    name: 'run_script',
    description: '运行一个 shell 脚本',
    inputSchema: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command'],
    },
    async execute(input) {
        const proc = Bun.spawn(['bash', '-c', input.command], {
            stdout: 'pipe',
            stderr: 'pipe',
        })
        await proc.exited
        return { exitCode: proc.exitCode }   // stdout/stderr 已经自动转发了
    },
}
```

### 一个文件导出多个工具

```js
// tools/math.js
const add = {
    name: 'add',
    description: '加法',
    inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] },
    async execute(input) { return input.a + input.b },
}

const multiply = {
    name: 'multiply',
    description: '乘法',
    inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] },
    async execute(input) { return input.a * input.b },
}

export default [add, multiply]    // 导出数组
```

### 主动停止 Agent 的工具

如果某个工具代表"任务完成"，可以让它返回 `stop: true`，Agent 循环会立刻停止：

```js
// tools/finish.js
export default {
    name: 'finish',
    description: '任务完成时调用这个工具',
    inputSchema: {
        type: 'object',
        properties: { summary: { type: 'string', description: '完成情况总结' } },
        required: ['summary'],
    },
    async execute(input) {
        return {
            stop: true,                        // 告诉 Loop 停止循环
            output: { type: 'text', value: input.summary },
        }
    },
}
```

### 工具权限询问

在敏感操作前可以要求用户确认：

```js
const agent = Agent.create({
    // ...
    callbacks: {
        onPermission: async ({ toolName, arguments: args }) => {
            // 只有 delete_file 工具需要确认
            if (toolName === 'delete_file') {
                console.log(`即将删除文件: ${args.path}`)
                // 实际项目里这里可以弹窗或读取用户输入
                return true    // 返回 true 允许，false 拒绝
            }
            return true        // 其他工具直接放行
        },
    },
})
```

---

## API 参考

### `Agent`

从包里导入的唯一入口：

```js
import Agent from '@kernel4632/agent-core'
```

#### `Agent.create(options?)`

创建一个独立的 Agent 实例，多个实例互不影响。

| 参数 | 类型 | 说明 |
|------|------|------|
| `options.id` | `string` | Agent ID，默认自动生成 |
| `options.history` | `array` | 初始历史消息，默认 `[]` |
| `options.config` | `object` | 模型配置，见下表 |
| `options.tools` | `object` | `Agent.tool.scan()` 的返回值 |
| `options.callbacks` | `object` | 回调函数集合，见下表 |

**`config` 字段：**

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `baseURL` | `''` | 模型服务地址（必填） |
| `apiKey` | `''` | API 密钥 |
| `model` | `''` | 模型名称（必填） |
| `protocol` | `'chat'` | 协议：`chat` / `responses` / `anthropic` / `gemini` |
| `system` | `''` | 系统提示词 |
| `stream` | `true` | 是否流式输出 |
| `maxTokens` | `undefined` | Token 上限，超过触发自动压缩 |
| `compactThreshold` | `0.8` | 压缩触发比例，0.8 表示到达 80% 时压缩 |
| `headers` | `{}` | 额外请求头 |
| `body` | `{}` | 额外请求体 |

**`callbacks` 回调：**

| 回调 | 触发时机 | 参数 |
|------|----------|------|
| `onStart` | 循环开始 | 无 |
| `onLLMStart` | 每次请求模型前 | `{ messages, tools }` |
| `onLLMFinish` | 模型请求完成 | LLM 返回的完整结果 |
| `onLLMEvent` | 流式事件（每个 token） | AI SDK 原生事件 |
| `onPermission` | 工具执行前 | `{ toolName, arguments, sessionId }` → 返回 `true/false` |
| `onToolCall` | 工具即将执行 | `{ toolCallId, toolName, input }` |
| `onToolOutput` | 工具有流式输出 | `{ tool, stream, data, toolCallId, toolName }` |
| `onToolResult` | 工具执行完成 | `{ toolName, output, ... }` |
| `onRetry` | 请求失败重试 | `{ attempt, error, delay }` |
| `onCompact` | 上下文压缩 | `compact-start` / AI SDK 事件 / `compact-finish` |

#### `agent.send(options)`

发送指令，启动 Agent 循环。如果上一次 `send` 还在运行，本次调用会先自动停止上一次任务，再启动新任务。

```js
const result = await agent.send({
    input: '帮我写个函数',          // 用户输入（必填）
    config: { model: '新模型' },    // 可选：覆盖部分配置
    history: [],                   // 可选：替换历史
    tools: newTools,               // 可选：替换工具集
    callbacks: { onLLMEvent: e => {} }, // 可选：合并回调
})

// result.reason:
//   'no-tool'    → 模型连续 3 轮没有调用工具，任务结束
//   'tool-stop'  → 某个工具返回了 stop: true
```

连续发送时，建议保存并处理旧任务的 Promise，避免出现未处理的中止错误：

```js
const oldTask = agent.send({ input: '执行旧任务' })
const newTask = agent.send({ input: '改执行新任务' }) // 自动停止旧任务

await oldTask.catch(() => {}) // 旧任务可能以 AbortError 结束
const result = await newTask
```

#### `agent.stop()`

停止正在运行的 Agent。

```js
await agent.stop()   // 等待完全停止后返回 { ok: true }
```

#### `agent.compact(options?)`

手动压缩当前历史（会先停止正在进行的任务）。

```js
const summary = await agent.compact({
    onCompact: event => console.log(event),
})
// summary 是压缩后的文本，同时会自动追加到 agent.history
```

#### `agent.history`

Agent 当前的完整历史消息数组，可直接读写。

#### `agent.running`

`null` 表示空闲；运行中时是 `{ controller, task }` 对象。

---

### `Agent.tool`

#### `Agent.tool.scan(directory)`

扫描目录里所有 `.js` 文件，返回工具集合。

```js
const tools = await Agent.tool.scan('./tools')
// tools.schema   → 给模型看的工具描述，传给 agent config 或 Loop.run
// tools.handlers → 执行器用的处理表，Tool.execute 需要它
```

每次调用都是独立的，多个 Agent 可以各扫描各的目录，互不影响。

#### `Agent.tool.execute(options)`

直接执行一个工具（通常不需要手动调用，Agent 内部会调用）。

```js
const result = await Agent.tool.execute({
    name: 'add',
    input: { a: 1, b: 2 },
    handlers: tools.handlers,
    signal: abortController.signal,   // 可选
    onOutput: output => {},           // 可选，接收流式输出
})
// result.output → 工具输出，格式为 { type: 'text'|'json', value: ... }
```

---

### `Agent.llm`

直接使用底层 LLM，绕过 Agent 循环。

#### `Agent.llm.chat(options)`

```js
const result = await Agent.llm.chat({
    baseURL: 'https://api.example.com/v1',
    apiKey: 'sk-xxx',
    model: 'gpt-4o',
    messages: [{ role: 'user', content: '你好' }],
    stream: true,                              // 默认 true
    onLLMEvent: event => console.log(event),   // 流式事件回调
})
// result.text          → 模型回复的文字
// result.toolCalls     → 工具调用列表
// result.usage         → token 用量
// result.finishReason  → 停止原因
```

---

### `Agent.context`

#### `Agent.context.build(options)`

把历史消息裁剪成模型能用的上下文，并估算 token 数。

```js
const { messages, token } = Agent.context.build({
    history: agent.history,
    system: '你是助手',
    tools: tools.schema,
})
// messages → 可以直接传给 LLM.chat 的消息数组
// token    → 估算的 token 数（用 gpt-tokenizer 计算）
```

压缩时自动保留：最初 3 条消息（保留用户目标）+ 最新总结 + 总结前 3 条 + 总结后所有消息。

---

### `History`（工具函数，按需引入）

```js
import History from '@kernel4632/agent-core/utils/history.js'

// 创建各种类型的历史块
History.user({ content: '你好' })
History.assistant({ content: '你好', toolCalls: [{ id: 'call-1', name: 'add', arguments: { a: 1, b: 2 } }] })
History.tool({ toolCallId: 'call-1', toolName: 'add', content: '3' })
History.compact({ content: '之前的对话总结...' })
```

---

## 运行测试

```bash
bun test
```

测试分两个文件：

- [`tests/agent.test.js`](tests/agent.test.js) — 测试 Agent 创建和上下文构建（不需要网络）
- [`tests/modules.test.js`](tests/modules.test.js) — 测试所有模块（内部会启动一个本地 mock 服务器）

查看覆盖率：

```bash
bun test --coverage
```

---

## 常见问题

**Q：支持 Node.js 吗？**

不支持。工具执行依赖 Bun 的 [`Worker`](utils/tool-worker.js) 和 [`Bun.Glob`](features/tool.js)，必须用 Bun 运行。

---

**Q：支持哪些模型提供商？**

通过 `config.protocol` 控制：

| protocol 值 | 适用场景 |
|-------------|----------|
| `chat`（默认） | OpenAI 以及任何兼容 OpenAI Chat 接口的中转站 |
| `responses` | OpenAI Responses API |
| `anthropic` | Anthropic 官方接口 |
| `gemini` | Google Gemini 接口 |

---

**Q：上下文太长会怎样？**

设置 `config.maxTokens` 后，当上下文超过该值的 80%（可用 `compactThreshold` 调整），Loop 会自动调用 Compact 把历史压缩成一段总结，然后继续运行。无需手动处理。

---

**Q：工具执行失败会让 Agent 崩溃吗？**

不会。工具失败会被捕获，错误信息会作为工具结果告诉模型，模型可以自行决定是否重试或换一种方式。只有工具文件本身语法错误导致 Worker 无法启动，才会抛出 Promise rejection。

---

**Q：多个工具是串行还是并行执行的？**

并行。模型在一轮里要求调用多个工具时，所有工具同时开跑（[`Promise.all`](features/loop.js:101)），结果按原顺序收集后一起写回历史。

---

**Q：怎么让 Agent 在任务完成时自动停止？**

有两种方式：

1. 写一个 `finish` 工具，让它 `return { stop: true }`，并在系统提示词里告诉模型"完成任务时调用 finish 工具"。
2. 不写 finish 工具，依赖默认行为：模型连续 3 轮不调用任何工具时，Loop 自动返回 `{ reason: 'no-tool' }`。

---

**Q：怎么中途停止 Agent？**

```js
const runPromise = agent.send({ input: '...' })

// 3 秒后强制停止
setTimeout(() => agent.stop(), 3000)

await runPromise.catch(() => {})    // stop() 会让 send() 以 AbortError 结束
```

或者在 `onPermission` 回调里返回 `false` 拒绝某次工具调用，但不会停止整个循环。
