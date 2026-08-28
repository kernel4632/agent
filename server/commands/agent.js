/*
// 创建一个独立 Agent。参数会成为 Agent 的公开内部状态。
const agent = Agent.create({
    history: [],
    config: {
        baseURL: "https://api.example.com/v1",
        apiKey: "sk-xxx",
        model: "model-name",
        protocol: "chat",
        stream: true,
        system: "你是一个编程助手。",
    },
    tools: {},
    callbacks: {},
})

// 发送消息。没有再次传入的参数继续使用 Agent 当前状态。
await agent.send({
    input: "帮我写个爬虫",
    callbacks: {
        onText: text => console.log(text),
        onPermission: async permission => true,
        onCompact: event => console.log(event),
    },
})

// 发送时也可以覆盖内部参数。
await agent.send({
    input: "继续",
    history: anotherHistory,
    config: anotherConfig,
    callbacks: { onText: text => console.log(text) },
})

// 停止当前运行。
await agent.stop()

// callbacks 中可使用下面这些回调：
// onStart: () => {}，循环开始时调用，无返回值。
// onPermission: ({ sessionId, callId, toolCallId, toolName, arguments }) => true | false，需要等待时可以返回 Promise。
// onText: text => {}，收到一段模型文字时调用，text 是字符串。
// onRetry: info => {}，模型请求重试时调用，info 是重试信息。
// onToolCall: call => {}，模型请求调用工具时调用，call 包含 toolCallId、toolName、input。
// onToolOutput: output => {}，工具产生实时输出时调用，output 包含工具调用信息和输出数据。
// onToolResult: result => {}，工具执行结束时调用，result 包含工具调用信息和最终结果。
// onCompact: event => {}，压缩过程通知，不改变压缩逻辑。
// event.type 为 compact-start、compact-text 或 compact-finish。
// compact-start: { type, messages, token, maxTokens }，压缩开始。
// compact-text: { type, text }，压缩内容；stream=true 时多次触发，否则触发一次。
// compact-finish: { type, messages, token }，压缩完成后的总结和 Token 数。
*/

import { nanoid } from 'nanoid'
import Context from '../features/context.js'
import Compact from '../features/compact.js'
import Loop from '../features/loop.js'
import Tool from '../features/tool.js'
import Message from '../utils/message.js'

// 创建一台独立 Agent：传入的对象会成为这台机器公开、可继续修改的内部状态。
const create = ({ id = nanoid(), history = [], config = {}, tools = {}, callbacks = {} } = {}) => {
    const agent = {
        id, // Agent 的身份只用于区分实例和权限等待。
        history, // 直接保存外部传入的数组，外部可以和 Agent 共同修改它。
        config: {
            baseURL: '', // 没有模型地址时，真正发送请求才会报错。
            apiKey: '', // 密钥只在模型请求时使用，不参与 Agent 流程判断。
            model: '', // 模型名称没有默认值，避免静默选择错误模型。
            protocol: 'chat', // 大多数兼容 OpenAI Chat 的服务使用这个协议。
            headers: {}, // 额外请求头没有传入时直接交给 LLM 使用空对象。
            body: {}, // 额外请求体没有传入时不覆盖模型请求参数。
            maxTokens: undefined, // 不设上限时不主动压缩，让模型服务决定是否超限。
            compactThreshold: 0.8, // 接近上限时提前压缩，默认在 80% 处开始。
            stream: true, // 压缩总结默认使用流式请求。
            system: '', // 没有系统提示词时仍允许 Agent 运行。
            ...config, // 传入配置覆盖默认配置，且配置结构只包含 Agent 需要的字段。
        },
        tools, // 工具表直接保存，后续 send 可以替换整张工具表。
        callbacks: { ...callbacks }, // 回调逐项保存，后续 send 只覆盖传入的回调。
        running: null, // null 表示空闲；运行对象保存当前停止控制器和任务。
    }

    // 发送指令：先更新本次传入的持久参数，再让 Loop 使用 Agent 当前状态。
    agent.send = async ({ input, ...options }) => {
        if (typeof input !== 'string' || !input.trim()) throw new TypeError('input must be a non-empty string') // 没有本次输入就没有可执行指令。
        if (agent.running) throw new Error(`Agent is already running: ${agent.id}`) // 同一台机器不能同时执行两次 send。
        if ('history' in options) agent.history = options.history // 传入空数组也代表明确覆盖历史。
        if ('config' in options) agent.config = { ...agent.config, ...options.config } // 配置按字段覆盖，未传字段继续保留。
        if ('tools' in options) agent.tools = options.tools // 工具是整体替换，不在 Agent 内部猜测如何合并。
        if ('callbacks' in options) agent.callbacks = { ...agent.callbacks, ...options.callbacks } // 回调逐项合并，避免替换一个回调时清掉其他回调。

        const controller = new AbortController() // stop() 通过它中断当前模型请求或工具。
        const user = Message.user({ content: input }) // 先把用户指令变成标准历史消息。
        agent.history.push(user) // Loop 直接使用这份公开数组，执行结果也会继续写入这里。
        agent.running = { controller } // 在启动异步任务前登记运行状态，阻止并发 send。

        // 异步任务只读取 Agent 当前状态；任务结束后把 Agent 恢复为空闲状态。
        const task = (async () => {
            const llm = {
                baseURL: agent.config.baseURL,
                apiKey: agent.config.apiKey,
                model: agent.config.model,
                protocol: agent.config.protocol,
                maxTokens: agent.config.maxTokens,
                compactThreshold: agent.config.compactThreshold,
                stream: agent.config.stream,
                options: {
                    headers: agent.config.headers,
                    body: agent.config.body,
                },
            }
            const result = await Loop.run({
                messages: agent.history,
                system: agent.config.system,
                tools: agent.tools,
                llm,
                buildContext: Context.build,
                compact: Compact.run,
                executeTool: Tool.execute,
                sessionId: agent.id,
                signal: controller.signal,
                onStart: agent.callbacks.onStart,
                onPermission: agent.callbacks.onPermission,
                onText: agent.callbacks.onText,
                onRetry: agent.callbacks.onRetry,
                onToolCall: agent.callbacks.onToolCall,
                onToolOutput: agent.callbacks.onToolOutput,
                onToolResult: agent.callbacks.onToolResult,
                onCompact: agent.callbacks.onCompact,
            })
            return result
        })()

        agent.running.task = task // 把任务放回公开运行对象，stop() 才能等待它完成。
        task.finally(() => {
            if (agent.running?.task === task) agent.running = null // 只清理自己的任务，避免覆盖后续运行状态。
        }).catch(() => {})
        return task
    }

    // 停止指令：只操作当前 Agent 自己的控制器。
    agent.stop = async () => {
        if (!agent.running) return { ok: false } // 空闲 Agent 没有需要停止的任务。
        agent.running.controller.abort() // 让 Loop、LLM 和 Worker 看到取消信号。
        await agent.running.task.catch(() => {}) // 等待清理完成，但不把停止异常变成新的异常。
        return { ok: true }
    }

    // 手动压缩：先停掉当前任务，再立即压缩当前上下文。
    agent.compact = async ({ onCompact, ...options } = {}) => {
        await agent.stop() // 用户主动压缩时，先结束正在进行的 send 或压缩。
        const context = Context.build({ history: agent.history, system: agent.config.system, tools: agent.tools })
        const controller = new AbortController() // stop() 也可以中断手动压缩。
        const llm = {
            baseURL: agent.config.baseURL,
            apiKey: agent.config.apiKey,
            model: agent.config.model,
            protocol: agent.config.protocol,
            options: { headers: agent.config.headers, body: agent.config.body },
        }
        const task = Compact.run({ ...options, messages: context.messages, llm, stream: agent.config.stream, onCompact, signal: controller.signal })
        agent.running = { controller, task } // 手动压缩和 send 共用同一个运行状态。
        try {
            const content = await task
            agent.history.push(Message.compact({ content })) // 总结文本写回公开历史。
            return content
        } finally {
            if (agent.running?.task === task) agent.running = null
        }
    }

    return agent
}

const Agent = { create, tool: Tool, context: Context }

export default Agent
