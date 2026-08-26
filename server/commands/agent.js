/* 
// 启动循环（循环在后台全自动运转，结果通过 SSE 推送）
const result = await Agent.send({
    sessionId: "session-1",        // 会话 ID
    input: "帮我写个爬虫",    // 用户消息
})
// result = { ok: true }

// 停止循环（立即终止）
const result = await Agent.stop({
    sessionId: "session-1",
})
// result = { ok: true }

// 处理工具审批
await Agent.decide({
    sessionId: "session-1",
    callId: "call-1",
    decision: true,
})
*/

import Config from './config.js'
import Session from './session.js'
import Context from '../features/context.js'
import Compact from '../features/compact.js'
import History from '../features/history.js'
import Loop from '../features/loop.js'
import Permission from '../features/permission.js'
import Tool from '../features/tool.js'
import Message from '../utils/message.js'
import Path from '../utils/path.js'
import SSE from '../utils/sse.js'

// 每个 sessionId 只能同时运行一个 Agent。
const running = new Map()
const approvals = new Map()

const approvalKey = (sessionId, callId) => `${sessionId}:${callId}`

const send = async ({ sessionId, input }) => {
    if (typeof input !== 'string' || !input.trim()) throw new TypeError('input must be a non-empty string')
    if (running.has(sessionId)) throw new Error(`Session is already running: ${sessionId}`)
    const session = await Session.read({ sessionId })
    const controller = new AbortController()
    const history = session.history
    const user = Message.user({ content: input })
    await History.add({ sessionId, message: user })
    await History.save({ sessionId })
    history.push(user)

    const task = run({ session, history, controller }).finally(() => {
        running.delete(sessionId)
        for (const [key, approval] of approvals) {
            if (approval.sessionId === sessionId) {
                approval.resolve(false)
                approvals.delete(key)
            }
        }
    })
    running.set(sessionId, { controller, task })
    task.catch(() => {})
    return { ok: true }
}

const run = async ({ session, history, controller }) => {
    const config = Config.get()
    const provider = (config.providers || []).find(item => item.name === session.provider)
    if (!provider) throw new Error(`Provider not found: ${session.provider}`)

    const model = typeof session.model === 'object' ? session.model.id : session.model
    let headers = provider.headers || {}
    if (typeof headers === 'string') headers = JSON.parse(headers || '{}')
    const modelSettings = provider.modelSettings?.[model] || {}
    const llm = {
        baseURL: provider.baseURL,
        apiKey: provider.apiKey || provider.key,
        model,
        protocol: provider.protocol === 'openai-compatible' ? 'chat' : provider.protocol,
        maxTokens: modelSettings.context || modelSettings.contextWindow || 128000,
        options: { headers },
    }
    const tools = await Tool.scan(Path.tools())
    const startLength = history.length

    try {
        const result = await Loop.run({
            messages: history,
            system: config.prompt?.system || '',
            tools,
            llm,
            buildContext: Context.build,
            compressContext: Compact.run,
            checkApproval: Permission.check,
            executeTool: Tool.execute,
            sessionId: session.id,
            signal: controller.signal,
            onText: text => SSE.send({ id: session.id, data: { type: 'text-delta', text } }),
            onRetry: info => SSE.send({ id: session.id, data: { type: 'retry', ...info } }),
            onToolCall: call => SSE.send({ id: session.id, data: { ...call, type: 'tool-call' } }),
            onApprove: approval => ask({ sessionId: session.id, ...approval }),
            onToolOutput: output => SSE.send({ id: session.id, data: { ...output, type: 'tool-output' } }),
            onToolResult: result => SSE.send({ id: session.id, data: { ...result, type: 'tool-result' } }),
            onCompress: text => SSE.send({ id: session.id, data: { type: 'compress-delta', text } }),
        })
        await persistNewMessages(session.id, history, startLength)
        await SSE.send({ id: session.id, data: { type: 'finish', ...result } })
        return result
    } catch (error) {
        await persistNewMessages(session.id, history, startLength)
        await SSE.send({ id: session.id, data: { type: 'error', message: error.message, name: error.name } })
        throw error
    }
}

const persistNewMessages = async (sessionId, history, startLength) => {
    // Loop 只修改工作数组。这里把完整的新消息逐条交给 History，最后统一保存。
    if (history.length === startLength) return
    for (const message of history.slice(startLength)) {
        await History.add({ sessionId, message })
    }
    await History.save({ sessionId })
}

const ask = ({ sessionId, callId, toolCallId, toolName, arguments: input }) => new Promise(resolve => {
    callId ||= toolCallId
    approvals.set(approvalKey(sessionId, callId), { sessionId, resolve })
    SSE.send({
        id: sessionId,
        data: { type: 'permission', callID: callId, tool: toolName, input },
    })
})

const stop = async ({ sessionId }) => {
    const task = running.get(sessionId)
    if (!task) return { ok: false }
    task.controller.abort()
    await task.task.catch(() => {})
    return { ok: true }
}

const decide = async ({ sessionId, callId, decision }) => {
    const approval = approvals.get(approvalKey(sessionId, callId))
    if (!approval || approval.sessionId !== sessionId) return { ok: false }
    approvals.delete(approvalKey(sessionId, callId))
    approval.resolve(Boolean(decision))
    return { ok: true }
}

export default { send, stop, decide }
