/*
// 创建一个独立 Agent。参数会成为 Agent 的公开内部状态。
const agent = Agent.create({
    history: [],
    config: {
        baseURL: "https://api.example.com/v1",
        apiKey: "sk-xxx",
        model: "model-name",
        protocol: "chat",
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
        onPermission: async permission => 'allow-once',
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
// onPermission: ({ sessionId, callId, toolCallId, toolName, arguments }) => 'allow-always' | 'allow-once' | 'deny'，需要等待时可以返回 Promise。
// onText: text => {}，收到一段模型文字时调用，text 是字符串。
// onRetry: info => {}，模型请求重试时调用，info 是重试信息。
// onToolCall: call => {}，模型请求调用工具时调用，call 包含 toolCallId、toolName、input。
// onToolOutput: output => {}，工具产生实时输出时调用，output 包含工具调用信息和输出数据。
// onToolResult: result => {}，工具执行结束时调用，result 包含工具调用信息和最终结果。
// onCompact: ({ sessionId, messages, token, maxTokens }) => ({ messages, token })，上下文超限时替换默认裁剪行为。
*/

import { nanoid } from 'nanoid'
import Context from '../features/context.js'
import Loop from '../features/loop.js'
import Tool from '../features/tool.js'
import Message from '../utils/message.js'

const create = ({ id = nanoid(), history = [], config = {}, tools = {}, callbacks = {} } = {}) => {
    const agent = {
        id,
        history,
        config: {
            baseURL: '',
            apiKey: '',
            model: '',
            protocol: 'chat',
            headers: {},
            body: {},
            maxTokens: undefined,
            system: '',
            toolPrompt: '请继续使用工具完成任务。',
            ...config,
        },
        tools,
        callbacks: { ...callbacks },
        running: null,
    }

    agent.send = async ({ input, ...options }) => {
        if (typeof input !== 'string' || !input.trim()) throw new TypeError('input must be a non-empty string')
        if (agent.running) throw new Error(`Agent is already running: ${agent.id}`)
        if ('history' in options) agent.history = options.history
        if ('config' in options) agent.config = { ...agent.config, ...options.config }
        if ('tools' in options) agent.tools = options.tools
        if ('callbacks' in options) agent.callbacks = { ...agent.callbacks, ...options.callbacks }

        const controller = new AbortController()
        const user = Message.user({ content: input })
        agent.history.push(user)
        agent.running = { controller }

        const task = (async () => {
            const llm = {
                baseURL: agent.config.baseURL,
                apiKey: agent.config.apiKey,
                model: agent.config.model,
                protocol: agent.config.protocol,
                maxTokens: agent.config.maxTokens,
                options: {
                    headers: agent.config.headers,
                    body: agent.config.body,
                },
            }
            const result = await Loop.run({
                messages: agent.history,
                system: agent.config.system,
                toolPrompt: agent.config.toolPrompt,
                tools: agent.tools,
                llm,
                buildContext: Context.build,
                compressContext: agent.callbacks.onCompact || (async ({ messages, token, maxTokens }) => ({ messages, token })),
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
            })
            return result
        })()

        agent.running.task = task
        task.finally(() => {
            if (agent.running?.task === task) agent.running = null
        }).catch(() => {})
        return task
    }

    agent.stop = async () => {
        if (!agent.running) return { ok: false }
        agent.running.controller.abort()
        await agent.running.task.catch(() => {})
        return { ok: true }
    }

    return agent
}

export default { create }
